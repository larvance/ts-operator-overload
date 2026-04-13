const ts = require("typescript");

const OPERATOR_ANNOTATION_DIAGNOSTIC_CODE = 93001;

const UNARY_ONLY_OPERATORS = new Set(["!", "~"]);
const BINARY_OR_UNARY_OPERATORS = new Set(["+", "-"]);
const BINARY_ONLY_OPERATORS = new Set([
    "*",
    "/",
    "%",
    "**",
    "==",
    "!=",
    "===",
    "!==",
    ">",
    ">=",
    "<",
    "<=",
    "&&",
    "||",
    "??",
    "&",
    "|",
    "^",
    "<<",
    ">>",
    ">>>"
]);

function parseOperatorComment(declaration) {
    if (!declaration) {
        return null;
    }
    const sourceFile = declaration.getSourceFile && declaration.getSourceFile();
    if (!sourceFile) {
        return null;
    }
    const sourceText = sourceFile.getFullText();
    const ranges = ts.getLeadingCommentRanges(sourceText, declaration.getFullStart()) || [];
    for (const range of ranges) {
        const text = sourceText.slice(range.pos, range.end);
        const match = text.match(/@operator\s*([+\-*/%<>=!&|^~?]{1,3})/);
        if (match) {
            return match[1];
        }
    }
    return null;
}

function createAnnotationDiagnostic(sourceFile, node, messageText) {
    const start = node && typeof node.getStart === "function" ? node.getStart(sourceFile) : 0;
    const length = node && typeof node.getWidth === "function" ? Math.max(1, node.getWidth(sourceFile)) : 1;
    return {
        file: sourceFile,
        start,
        length,
        category: ts.DiagnosticCategory.Error,
        code: OPERATOR_ANNOTATION_DIAGNOSTIC_CODE,
        source: "ts-operator-overload",
        messageText
    };
}

function getOwnerType(declaration, checker) {
    const owner = declaration && declaration.parent;
    if (!owner) {
        return null;
    }
    if (!ts.isClassLike(owner) && !ts.isInterfaceDeclaration(owner)) {
        return null;
    }
    try {
        return checker.getTypeAtLocation(owner);
    } catch {
        return null;
    }
}

function getParameterTypes(declaration, checker) {
    const signature = checker.getSignatureFromDeclaration(declaration);
    if (!signature) {
        return [];
    }
    return signature.getParameters().map((parameter) => checker.getTypeOfSymbolAtLocation(parameter, declaration));
}

function typeIncludesOwner(ownerType, parameterType, checker) {
    if (!ownerType || !parameterType) {
        return false;
    }
    return checker.isTypeAssignableTo(ownerType, parameterType) || checker.isTypeAssignableTo(parameterType, ownerType);
}

function isStaticMethodDeclaration(declaration) {
    if (!ts.isMethodDeclaration(declaration) || !Array.isArray(declaration.modifiers)) {
        return false;
    }
    return declaration.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}

function validateAnnotatedMethod(sourceFile, declaration, operatorText, checker) {
    const diagnostics = [];
    const parameterTypes = getParameterTypes(declaration, checker);
    const arity = parameterTypes.length;
    const ownerType = getOwnerType(declaration, checker);
    const displayName = declaration.name && ts.isIdentifier(declaration.name) ? declaration.name.text : "<method>";

    const isUnaryOnly = UNARY_ONLY_OPERATORS.has(operatorText);
    const isBinaryOrUnary = BINARY_OR_UNARY_OPERATORS.has(operatorText);
    const isBinaryOnly = BINARY_ONLY_OPERATORS.has(operatorText);

    if (!isUnaryOnly && !isBinaryOrUnary && !isBinaryOnly) {
        diagnostics.push(createAnnotationDiagnostic(
            sourceFile,
            declaration.name || declaration,
            `Unsupported @operator annotation '${operatorText}' on '${displayName}'.`
        ));
        return diagnostics;
    }

    if (isUnaryOnly && arity > 1) {
        diagnostics.push(createAnnotationDiagnostic(
            sourceFile,
            declaration.name || declaration,
            `Invalid @operator${operatorText} signature on '${displayName}'. Unary operators accept only '${displayName}()' or '${displayName}(a: thisType)'.`
        ));
        return diagnostics;
    }

    if (isBinaryOnly && arity === 0) {
        diagnostics.push(createAnnotationDiagnostic(
            sourceFile,
            declaration.name || declaration,
            `Invalid @operator${operatorText} signature on '${displayName}'. Binary operators require one or two parameters.`
        ));
        return diagnostics;
    }

    if (arity > 2) {
        const binaryHelp = `Use '${displayName}(b)' or 'static ${displayName}(a, b)'.`;
        const unaryHelp = ` For unary-capable operators, you can also use '${displayName}()' or '${displayName}(a: thisType)'.`;
        const messageText = (isUnaryOnly || isBinaryOrUnary)
            ? `Invalid @operator${operatorText} signature on '${displayName}'. ${binaryHelp}${unaryHelp}`
            : `Invalid @operator${operatorText} signature on '${displayName}'. ${binaryHelp}`;
        diagnostics.push(createAnnotationDiagnostic(
            sourceFile,
            declaration.name || declaration,
            messageText
        ));
        return diagnostics;
    }

    if ((isBinaryOnly || isBinaryOrUnary) && arity === 2 && !isStaticMethodDeclaration(declaration)) {
        diagnostics.push(createAnnotationDiagnostic(
            sourceFile,
            declaration.name || declaration,
            `Invalid @operator${operatorText} signature on '${displayName}'. Two-argument operator methods must be declared static.`
        ));
        return diagnostics;
    }

    if ((isUnaryOnly || isBinaryOrUnary) && arity === 1) {
        const oneArgLooksUnary = typeIncludesOwner(ownerType, parameterTypes[0], checker);
        if (isUnaryOnly && !oneArgLooksUnary) {
            diagnostics.push(createAnnotationDiagnostic(
                sourceFile,
                declaration.parameters[0],
                `Invalid @operator${operatorText} signature on '${displayName}'. Unary one-argument form must be '${displayName}(a: thisType)'.`
            ));
            return diagnostics;
        }
    }

    if ((isBinaryOnly || isBinaryOrUnary) && arity === 2) {
        const hasSelfOnEitherSide = typeIncludesOwner(ownerType, parameterTypes[0], checker)
            || typeIncludesOwner(ownerType, parameterTypes[1], checker);
        if (!hasSelfOnEitherSide) {
            diagnostics.push(createAnnotationDiagnostic(
                sourceFile,
                declaration.name || declaration,
                `Invalid @operator${operatorText} signature on '${displayName}'. Two-argument form must include the owning type in either first or second parameter.`
            ));
            return diagnostics;
        }
    }

    return diagnostics;
}

function getOperatorAnnotationDiagnosticsForSourceFile(program, sourceFile) {
    if (!program || !sourceFile || sourceFile.isDeclarationFile) {
        return [];
    }

    const checker = program.getTypeChecker();
    const diagnostics = [];

    function visit(node) {
        if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
            const operatorText = parseOperatorComment(node);
            if (operatorText) {
                diagnostics.push(...validateAnnotatedMethod(sourceFile, node, operatorText, checker));
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return diagnostics;
}

function getOperatorAnnotationDiagnosticsForFile(program, fileName) {
    if (!program || !fileName) {
        return [];
    }
    const sourceFile = program.getSourceFile(fileName);
    return getOperatorAnnotationDiagnosticsForSourceFile(program, sourceFile);
}

module.exports = {
    OPERATOR_ANNOTATION_DIAGNOSTIC_CODE,
    getOperatorAnnotationDiagnosticsForSourceFile,
    getOperatorAnnotationDiagnosticsForFile
};

