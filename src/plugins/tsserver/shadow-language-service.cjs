const ts = require("typescript");
const {
    resolveBinaryOperatorText,
    resolveUnaryOperatorText,
    resolveCompoundAssignmentText,
    resolveIncrementText
} = require("../../core/operator-map.cjs");
const {
    isNumberLike,
    resolveUnaryAnnotatedMethod,
    resolveBinaryAnnotatedMethod,
    resolveIncrementAnnotatedMethod,
    resolveSmartBinaryFallback
} = require("../../core/type-utils.cjs");

const shadowCacheByHost = new WeakMap();

function getOptionsKey(options) {
    const shadowScope = options && options.shadowScope === "project" ? "project" : "file";
    return `${options && options.allowRightOperand ? "1" : "0"}:${shadowScope}`;
}

function getProjectVersion(baseHost, fileName) {
    if (baseHost && typeof baseHost.getProjectVersion === "function") {
        return `p:${baseHost.getProjectVersion()}`;
    }
    if (baseHost && typeof baseHost.getScriptVersion === "function" && fileName) {
        return `f:${baseHost.getScriptVersion(fileName) || "0"}`;
    }
    return "none";
}

function normalizePathForCompare(filePath) {
    return String(filePath || "").replace(/\\/g, "/").toLowerCase();
}

function resolveRequestedFileName(program, host, requestedFileName) {
    if (!requestedFileName) {
        return null;
    }
    if (program.getSourceFile(requestedFileName)) {
        return requestedFileName;
    }
    const normalizedRequested = normalizePathForCompare(requestedFileName);
    for (const candidate of host.getScriptFileNames()) {
        if (normalizePathForCompare(candidate) === normalizedRequested) {
            return candidate;
        }
    }
    return requestedFileName;
}

function getFromPathMap(map, fileName) {
    if (map.has(fileName)) {
        return map.get(fileName);
    }
    const normalized = normalizePathForCompare(fileName);
    return map.get(normalized);
}


function collectRewriteEdits(sourceFile, checker, _options) {
    const edits = [];

    function getResolvedCallText(baseText, resolved) {
        if (resolved && resolved.invokeKind === "static" && resolved.ownerName) {
            return `${resolved.ownerName}.${resolved.methodName}`;
        }
        return `${baseText}.${resolved.methodName}`;
    }

    function getResolvedUnaryCallText(operandText, resolvedUnary) {
        const target = `${operandText}.${resolvedUnary.methodName}`;
        if (resolvedUnary.arity === 0) {
            return `${target}()`;
        }
        return `${target}(${operandText})`;
    }

    function getResolvedBinaryCallText(leftText, rightText, resolvedBinary) {
        const targetText = resolvedBinary.side === "right"
            ? getResolvedCallText(rightText, resolvedBinary)
            : getResolvedCallText(leftText, resolvedBinary);
        if (resolvedBinary.arity === 1) {
            return `${targetText}(${rightText})`;
        }
        return `${targetText}(${leftText}, ${rightText})`;
    }

    function visit(node) {
        ts.forEachChild(node, visit);

        if (ts.isBinaryExpression(node)) {
            const assignmentOpText = resolveCompoundAssignmentText(node.operatorToken.kind);
            if (assignmentOpText) {
                const leftText = node.left.getText(sourceFile);
                const rightText = node.right.getText(sourceFile);
                const leftType = checker.getTypeAtLocation(node.left);
                const rightType = checker.getTypeAtLocation(node.right);
                const resolvedAssignment = resolveBinaryAnnotatedMethod(leftType, rightType, assignmentOpText, checker);
                if (resolvedAssignment && resolvedAssignment.side === "left" && resolvedAssignment.arity === 1) {
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${leftText} = ${getResolvedCallText(leftText, resolvedAssignment)}(${rightText})`
                    });
                    return;
                }

                if (resolvedAssignment && resolvedAssignment.side === "left" && resolvedAssignment.arity === 2) {
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${leftText} = ${getResolvedCallText(leftText, resolvedAssignment)}(${leftText}, ${rightText})`
                    });
                    return;
                }

                if (resolvedAssignment && resolvedAssignment.side === "right" && resolvedAssignment.arity === 2) {
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${leftText} = ${getResolvedCallText(rightText, resolvedAssignment)}(${leftText}, ${rightText})`
                    });
                    return;
                }
            }

            const operatorText = resolveBinaryOperatorText(node.operatorToken.kind);
            if (!operatorText) {
                return;
            }

            const leftType = checker.getTypeAtLocation(node.left);
            const rightType = checker.getTypeAtLocation(node.right);

            if (isNumberLike(leftType) && isNumberLike(rightType)) {
                return;
            }

            const leftText = node.left.getText(sourceFile);
            const rightText = node.right.getText(sourceFile);
            const resolvedBinary = resolveBinaryAnnotatedMethod(leftType, rightType, operatorText, checker);
            if (resolvedBinary && resolvedBinary.side === "left" && resolvedBinary.arity === 1) {
                edits.push({
                    start: node.getStart(sourceFile),
                    end: node.getEnd(),
                    replacement: getResolvedBinaryCallText(leftText, rightText, resolvedBinary)
                });
                return;
            }

            if (resolvedBinary && resolvedBinary.side === "left" && resolvedBinary.arity === 2) {
                edits.push({
                    start: node.getStart(sourceFile),
                    end: node.getEnd(),
                    replacement: getResolvedBinaryCallText(leftText, rightText, resolvedBinary)
                });
                return;
            }

            if (resolvedBinary && resolvedBinary.side === "right" && resolvedBinary.arity === 2) {
                edits.push({
                    start: node.getStart(sourceFile),
                    end: node.getEnd(),
                    replacement: getResolvedBinaryCallText(leftText, rightText, resolvedBinary)
                });
                return;
            }

            const smartFallback = resolveSmartBinaryFallback(leftType, rightType, operatorText, checker);
            if (smartFallback && smartFallback.kind === "negate-binary") {
                const inner = getResolvedBinaryCallText(leftText, rightText, smartFallback.baseResolved);
                edits.push({
                    start: node.getStart(sourceFile),
                    end: node.getEnd(),
                    replacement: `!(${inner})`
                });
                return;
            }

            if (smartFallback && smartFallback.kind === "add-with-native-negation") {
                const negRightText = `-(${rightText})`;
                const callText = getResolvedBinaryCallText(leftText, negRightText, smartFallback.addResolved);
                edits.push({
                    start: node.getStart(sourceFile),
                    end: node.getEnd(),
                    replacement: callText
                });
                return;
            }

            if (smartFallback && smartFallback.kind === "add-with-overload-negation") {
                const negRightText = getResolvedUnaryCallText(rightText, smartFallback.negResolved);
                const callText = getResolvedBinaryCallText(leftText, negRightText, smartFallback.addResolved);
                edits.push({
                    start: node.getStart(sourceFile),
                    end: node.getEnd(),
                    replacement: callText
                });
            }
        }

        if (ts.isPrefixUnaryExpression(node)) {
            const incrementText = resolveIncrementText(node.operator);
            if (incrementText) {
                const operandType = checker.getTypeAtLocation(node.operand);
                const resolvedIncrement = resolveIncrementAnnotatedMethod(operandType, incrementText, checker);
                if (resolvedIncrement && resolvedIncrement.arity === 1) {
                    const operandText = node.operand.getText(sourceFile);
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${operandText} = ${getResolvedCallText(operandText, resolvedIncrement)}(1)`
                    });
                }

                if (resolvedIncrement && resolvedIncrement.arity === 2) {
                    const operandText = node.operand.getText(sourceFile);
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${operandText} = ${getResolvedCallText(operandText, resolvedIncrement)}(${operandText}, 1)`
                    });
                }
            }

            const unaryText = resolveUnaryOperatorText(node.operator);
            if (unaryText) {
                const operandType = checker.getTypeAtLocation(node.operand);
                const resolvedUnary = resolveUnaryAnnotatedMethod(operandType, unaryText, checker);
                if (resolvedUnary && resolvedUnary.arity === 0) {
                    const operandText = node.operand.getText(sourceFile);
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${operandText}.${resolvedUnary.methodName}()`
                    });
                    return;
                }
                if (resolvedUnary && resolvedUnary.arity === 1) {
                    const operandText = node.operand.getText(sourceFile);
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${operandText}.${resolvedUnary.methodName}(${operandText})`
                    });
                    return;
                }
            }
        }

        if (ts.isPostfixUnaryExpression(node)) {
            const incrementText = resolveIncrementText(node.operator);
            if (incrementText) {
                const operandType = checker.getTypeAtLocation(node.operand);
                const resolvedIncrement = resolveIncrementAnnotatedMethod(operandType, incrementText, checker);
                if (resolvedIncrement && resolvedIncrement.arity === 1) {
                    const operandText = node.operand.getText(sourceFile);
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${operandText} = ${getResolvedCallText(operandText, resolvedIncrement)}(1)`
                    });
                }

                if (resolvedIncrement && resolvedIncrement.arity === 2) {
                    const operandText = node.operand.getText(sourceFile);
                    edits.push({
                        start: node.getStart(sourceFile),
                        end: node.getEnd(),
                        replacement: `${operandText} = ${getResolvedCallText(operandText, resolvedIncrement)}(${operandText}, 1)`
                    });
                }
            }
        }
    }

    visit(sourceFile);

    edits.sort((a, b) => b.start - a.start);
    return edits;
}

function applyEditsToText(text, edits) {
    let output = text;
    for (const edit of edits) {
        output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    }
    return output;
}

function createPositionMapper(editsDescending, originalLength, transformedLength) {
    const edits = [...editsDescending].sort((a, b) => a.start - b.start);

    function mapNewToOld(position) {
        let oldCursor = 0;
        let newCursor = 0;

        for (const edit of edits) {
            const unchanged = edit.start - oldCursor;
            const unchangedNewEnd = newCursor + unchanged;
            if (position < unchangedNewEnd) {
                return oldCursor + (position - newCursor);
            }

            oldCursor = edit.end;
            newCursor = unchangedNewEnd;

            const replacedNewEnd = newCursor + edit.replacement.length;
            if (position < replacedNewEnd) {
                return edit.start;
            }

            newCursor = replacedNewEnd;
        }

        const tailMapped = oldCursor + (position - newCursor);
        if (tailMapped < 0) {
            return 0;
        }
        if (tailMapped > originalLength) {
            return originalLength;
        }
        return tailMapped;
    }

    function mapOldToNew(position) {
        let oldCursor = 0;
        let newCursor = 0;

        for (const edit of edits) {
            const unchanged = edit.start - oldCursor;
            const unchangedOldEnd = oldCursor + unchanged;
            if (position < unchangedOldEnd) {
                return newCursor + (position - oldCursor);
            }

            oldCursor = edit.end;
            const unchangedNewEnd = newCursor + unchanged;
            if (position < oldCursor) {
                return unchangedNewEnd;
            }

            newCursor = unchangedNewEnd + edit.replacement.length;
        }

        const tailMapped = newCursor + (position - oldCursor);
        if (tailMapped < 0) {
            return 0;
        }
        if (tailMapped > transformedLength) {
            return transformedLength;
        }
        return tailMapped;
    }

    return {
        mapNewToOld,
        mapOldToNew,
        originalLength,
        transformedLength
    };
}

function rewriteProgramFiles(program, host, options, requestedFileName) {
    const checker = program.getTypeChecker();
    const shadowScope = options && options.shadowScope === "project" ? "project" : "file";
    const resolvedRequestedFileName = resolveRequestedFileName(program, host, requestedFileName);
    const fileNames = shadowScope === "project"
        ? host.getScriptFileNames()
        : (resolvedRequestedFileName ? [resolvedRequestedFileName] : host.getScriptFileNames());
    const transformedFiles = new Map();
    const mappers = new Map();

    for (const fileName of fileNames) {
        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile || sourceFile.isDeclarationFile) {
            continue;
        }

        const text = sourceFile.getFullText();
        const edits = collectRewriteEdits(sourceFile, checker, options);
        if (edits.length === 0) {
            continue;
        }

        const transformedText = applyEditsToText(text, edits);
        const mapper = createPositionMapper(edits, text.length, transformedText.length);
        transformedFiles.set(fileName, transformedText);
        transformedFiles.set(normalizePathForCompare(fileName), transformedText);
        mappers.set(fileName, mapper);
        mappers.set(normalizePathForCompare(fileName), mapper);
    }

    return {
        transformedFiles,
        mappers
    };
}

function createShadowLanguageService(tsModule, baseHost, compilerOptions, transformedFiles, documentRegistry) {
    const shadowHost = {
        getCompilationSettings: () => compilerOptions,
        getScriptFileNames: () => baseHost.getScriptFileNames(),
        getScriptVersion: (fileName) => (baseHost.getScriptVersion ? baseHost.getScriptVersion(fileName) : "0"),
        getScriptSnapshot: (fileName) => {
            const transformed = getFromPathMap(transformedFiles, fileName);
            if (typeof transformed === "string") {
                return tsModule.ScriptSnapshot.fromString(transformed);
            }

            const snapshot = baseHost.getScriptSnapshot && baseHost.getScriptSnapshot(fileName);
            if (snapshot) {
                return snapshot;
            }

            if (!tsModule.sys.fileExists(fileName)) {
                return undefined;
            }
            return tsModule.ScriptSnapshot.fromString(tsModule.sys.readFile(fileName) || "");
        },
        getCurrentDirectory: () => baseHost.getCurrentDirectory(),
        getDefaultLibFileName: (options) => tsModule.getDefaultLibFilePath(options),
        fileExists: (fileName) => {
            if (typeof getFromPathMap(transformedFiles, fileName) === "string") {
                return true;
            }
            if (baseHost.fileExists) {
                return baseHost.fileExists(fileName);
            }
            return tsModule.sys.fileExists(fileName);
        },
        readFile: (fileName) => {
            const transformed = getFromPathMap(transformedFiles, fileName);
            if (typeof transformed === "string") {
                return transformed;
            }
            if (baseHost.readFile) {
                return baseHost.readFile(fileName);
            }
            return tsModule.sys.readFile(fileName);
        },
        readDirectory: baseHost.readDirectory ? baseHost.readDirectory.bind(baseHost) : tsModule.sys.readDirectory,
        directoryExists: baseHost.directoryExists ? baseHost.directoryExists.bind(baseHost) : tsModule.sys.directoryExists,
        getDirectories: baseHost.getDirectories ? baseHost.getDirectories.bind(baseHost) : tsModule.sys.getDirectories
    };

    // Ensure static analyzers treat required LanguageServiceHost members as used.
    void shadowHost.getCompilationSettings;
    void shadowHost.getDefaultLibFileName;

    return tsModule.createLanguageService(shadowHost, documentRegistry || tsModule.createDocumentRegistry());
}

function remapDiagnosticPosition(diagnostic, mapper) {
    if (!mapper || typeof diagnostic.start !== "number") {
        return diagnostic;
    }

    const start = mapper.mapNewToOld(diagnostic.start);
    const end = typeof diagnostic.length === "number"
        ? mapper.mapNewToOld(diagnostic.start + diagnostic.length)
        : start;

    return {
        ...diagnostic,
        start,
        length: Math.max(1, end - start)
    };
}

function createShadowContext(tsModule, info, options, fileName) {
    const baseLanguageService = info.languageService;
    const program = baseLanguageService.getProgram();
    if (!program) {
        return null;
    }

    const baseHost = info.languageServiceHost;
    if (!baseHost || typeof baseHost.getScriptFileNames !== "function") {
        return null;
    }

    let cacheEntry = shadowCacheByHost.get(baseHost);
    if (!cacheEntry) {
        cacheEntry = {
            key: "",
            context: null,
            documentRegistry: tsModule.createDocumentRegistry()
        };
        shadowCacheByHost.set(baseHost, cacheEntry);
    }

    const cacheKey = `${getOptionsKey(options)}:${fileName || ""}:${getProjectVersion(baseHost, fileName)}`;
    if (cacheEntry.context && cacheEntry.key === cacheKey) {
        return cacheEntry.context;
    }

    if (cacheEntry.context && cacheEntry.context.shadowLanguageService) {
        cacheEntry.context.shadowLanguageService.dispose();
    }

    const rewriteResult = rewriteProgramFiles(program, baseHost, options, fileName);
    const shadowLanguageService = createShadowLanguageService(
        tsModule,
        baseHost,
        program.getCompilerOptions(),
        rewriteResult.transformedFiles,
        cacheEntry.documentRegistry
    );

    cacheEntry.context = {
        baseLanguageService,
        shadowLanguageService,
        rewriteResult
    };
    cacheEntry.key = cacheKey;

    return cacheEntry.context;
}

function getExistingShadowContext(tsModule, info, options, fileName) {
    const baseHost = info.languageServiceHost;
    if (!baseHost || typeof baseHost.getScriptFileNames !== "function") {
        return null;
    }

    const cacheEntry = shadowCacheByHost.get(baseHost);
    if (!cacheEntry) {
        return null;
    }

    const cacheKey = `${getOptionsKey(options)}:${fileName || ""}:${getProjectVersion(baseHost, fileName)}`;
    if (cacheEntry.key !== cacheKey) {
        return null;
    }

    return cacheEntry.context || null;
}

function warmShadowContext(tsModule, info, options, fileName) {
    return createShadowContext(tsModule, info, options, fileName);
}

function remapTextSpan(span, mapper) {
    if (!span || !mapper || typeof span.start !== "number") {
        return span;
    }

    const start = mapper.mapNewToOld(span.start);
    const end = typeof span.length === "number"
        ? mapper.mapNewToOld(span.start + span.length)
        : start;

    return {
        ...span,
        start,
        length: Math.max(1, end - start)
    };
}

function remapPosition(position, mapper) {
    if (!mapper || typeof position !== "number") {
        return position;
    }
    return mapper.mapNewToOld(position);
}

function remapHintSpan(span, mapper) {
    if (!span || typeof span.start !== "number") {
        return span;
    }
    return {
        ...span,
        start: remapPosition(span.start, mapper),
        length: typeof span.length === "number" ? Math.max(1, remapPosition(span.start + span.length, mapper) - remapPosition(span.start, mapper)) : span.length
    };
}

function remapCompletionResult(completions, mapper) {
    if (!completions || !Array.isArray(completions.entries) || !mapper) {
        return completions;
    }

    return {
        ...completions,
        optionalReplacementSpan: remapTextSpan(completions.optionalReplacementSpan, mapper),
        entries: completions.entries.map((entry) => ({
            ...entry,
            replacementSpan: remapTextSpan(entry.replacementSpan, mapper)
        }))
    };
}

function remapCompletionDetails(details, mapper) {
    if (!details || !mapper) {
        return details;
    }

    return {
        ...details,
        codeActions: Array.isArray(details.codeActions)
            ? details.codeActions.map((action) => ({
                ...action,
                changes: Array.isArray(action.changes)
                    ? action.changes.map((change) => ({
                        ...change,
                        textChanges: Array.isArray(change.textChanges)
                            ? change.textChanges.map((textChange) => ({
                                ...textChange,
                                span: remapTextSpan(textChange.span, mapper)
                            }))
                            : change.textChanges
                    }))
                    : action.changes
            }))
            : details.codeActions
    };
}

function remapInlayHints(hints, mapper) {
    if (!Array.isArray(hints) || !mapper) {
        return hints;
    }

    return hints.map((hint) => ({
        ...hint,
        position: remapPosition(hint.position, mapper),
        textEdits: Array.isArray(hint.textEdits)
            ? hint.textEdits.map((edit) => ({
                ...edit,
                span: remapHintSpan(edit.span, mapper)
            }))
            : hint.textEdits
    }));
}

function getShadowSemanticDiagnostics(tsModule, info, fileName, options) {
    const context = createShadowContext(tsModule, info, options, fileName);
    if (!context) {
        return info.languageService.getSemanticDiagnostics(fileName);
    }

    const diagnostics = context.shadowLanguageService.getSemanticDiagnostics(fileName);
    const mapper = getFromPathMap(context.rewriteResult.mappers, fileName);
    return diagnostics.map((diagnostic) => remapDiagnosticPosition(diagnostic, mapper));
}

function getShadowQuickInfoAtPosition(tsModule, info, fileName, position, options) {
    const context = createShadowContext(tsModule, info, options, fileName);
    if (!context) {
        return info.languageService.getQuickInfoAtPosition(fileName, position);
    }

    const mapper = getFromPathMap(context.rewriteResult.mappers, fileName);
    const newPosition = mapper ? mapper.mapOldToNew(position) : position;
    const quickInfo = context.shadowLanguageService.getQuickInfoAtPosition(fileName, newPosition);
    if (!quickInfo) {
        return quickInfo;
    }

    return {
        ...quickInfo,
        textSpan: remapTextSpan(quickInfo.textSpan, mapper)
    };
}

function getShadowCompletionsAtPosition(tsModule, info, fileName, position, options, preferences, triggerCharacter, triggerKind) {
    const context = createShadowContext(tsModule, info, options, fileName);
    if (!context) {
        return info.languageService.getCompletionsAtPosition(fileName, position, preferences, triggerCharacter, triggerKind);
    }

    const mapper = getFromPathMap(context.rewriteResult.mappers, fileName);
    const newPosition = mapper ? mapper.mapOldToNew(position) : position;
    const completions = context.shadowLanguageService.getCompletionsAtPosition(
        fileName,
        newPosition,
        preferences,
        triggerCharacter,
        triggerKind
    );
    return remapCompletionResult(completions, mapper);
}

function getShadowCompletionEntryDetails(tsModule, info, fileName, position, options, detailArgs) {
    const context = createShadowContext(tsModule, info, options, fileName);
    if (!context) {
        return info.languageService.getCompletionEntryDetails(fileName, position, ...detailArgs);
    }

    const mapper = getFromPathMap(context.rewriteResult.mappers, fileName);
    const newPosition = mapper ? mapper.mapOldToNew(position) : position;
    const details = context.shadowLanguageService.getCompletionEntryDetails(fileName, newPosition, ...detailArgs);
    return remapCompletionDetails(details, mapper);
}

function getShadowInlayHints(tsModule, info, fileName, span, options, preferences) {
    const context = createShadowContext(tsModule, info, options, fileName);
    if (!context) {
        const baseMethod = typeof info.languageService.provideInlayHints === "function"
            ? info.languageService.provideInlayHints.bind(info.languageService)
            : (typeof info.languageService.getInlayHints === "function" ? info.languageService.getInlayHints.bind(info.languageService) : null);
        return baseMethod ? baseMethod(fileName, span, preferences) : [];
    }

    const mapper = getFromPathMap(context.rewriteResult.mappers, fileName);
    const newSpan = mapper && span && typeof span.start === "number" && typeof span.length === "number"
        ? {
            start: mapper.mapOldToNew(span.start),
            length: Math.max(1, mapper.mapOldToNew(span.start + span.length) - mapper.mapOldToNew(span.start))
        }
        : span;

    const shadowMethod = typeof context.shadowLanguageService.provideInlayHints === "function"
        ? context.shadowLanguageService.provideInlayHints.bind(context.shadowLanguageService)
        : (typeof context.shadowLanguageService.getInlayHints === "function" ? context.shadowLanguageService.getInlayHints.bind(context.shadowLanguageService) : null);

    if (!shadowMethod) {
        return [];
    }

    const hints = shadowMethod(fileName, newSpan, preferences);
    return remapInlayHints(hints, mapper);
}

module.exports = {
    getExistingShadowContext,
    warmShadowContext,
    getShadowSemanticDiagnostics,
    getShadowQuickInfoAtPosition,
    getShadowCompletionsAtPosition,
    getShadowCompletionEntryDetails,
    getShadowInlayHints
};
