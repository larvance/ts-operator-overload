const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const ts = require("typescript");
const createPlugin = require("../src/plugins/tsserver/index.cjs");

const repoRoot = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
    throw new Error(message);
}

function readUtf8(filePath) {
    return fs.readFileSync(filePath, "utf8");
}


function findFileRecursive(folder, fileName) {
    const entries = fs.readdirSync(folder, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = path.join(folder, entry.name);
        if (entry.isFile() && entry.name === fileName) {
            return fullPath;
        }
        if (entry.isDirectory()) {
            const nested = findFileRecursive(fullPath, fileName);
            if (nested) {
                return nested;
            }
        }
    }
    return null;
}

function isCaseFolder(folder) {
    return fs.existsSync(path.join(folder, "tsconfig.json")) && fs.existsSync(path.join(folder, "expected.txt"));
}

function collectCaseFolders(rootFolder) {
    const results = [];
    const entries = fs.readdirSync(rootFolder, {withFileTypes: true});
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        if (entry.name === "dist" || entry.name === "node_modules") {
            continue;
        }
        const fullPath = path.join(rootFolder, entry.name);
        if (isCaseFolder(fullPath)) {
            results.push(fullPath);
            continue;
        }
        results.push(...collectCaseFolders(fullPath));
    }
    return results;
}

function loadConfig(projectPath) {
    const configFile = ts.readConfigFile(projectPath, ts.sys.readFile);
    if (configFile.error) {
        throw new Error(ts.formatDiagnosticsWithColorAndContext([configFile.error], {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: ts.sys.getCurrentDirectory,
            getNewLine: () => ts.sys.newLine
        }));
    }

    const configDir = path.dirname(projectPath);
    return ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir);
}

function createLanguageService(parsed, projectRoot) {
    const files = new Map(parsed.fileNames.map((file) => [file, "0"]));

    const host = {
        getCompilationSettings: () => parsed.options,
        getScriptFileNames: () => [...files.keys()],
        getScriptVersion: (fileName) => files.get(fileName) || "0",
        getScriptSnapshot: (fileName) => {
            if (!ts.sys.fileExists(fileName)) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) || "");
        },
        getCurrentDirectory: () => projectRoot,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories
    };

    // Required by LanguageServiceHost even if static analyzers cannot infer external usage.
    void host.getCompilationSettings;
    void host.getDefaultLibFileName;

    const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
    return {languageService, host};
}

function hasOperatorError(diagnostics) {
    return diagnostics.some((diagnostic) => diagnostic.code === 2362 || diagnostic.code === 2363 || diagnostic.code === 2365 || diagnostic.code === 2367);
}

function hasPropertyMissingError(diagnostics) {
    return diagnostics.some((diagnostic) => diagnostic.code === 2339);
}

function formatDiagnostic(diag) {
    if (!diag.file || typeof diag.start !== "number") {
        return `TS${diag.code}`;
    }
    const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
    return `${diag.file.fileName}:${pos.line + 1}:${pos.character + 1} TS${diag.code}`;
}

function findIdentifierPosition(filePath, identifier) {
    const text = ts.sys.readFile(filePath) || "";
    const declarationPattern = new RegExp(`\\bconst\\s+${identifier}\\b`);
    const declMatch = declarationPattern.exec(text);
    const index = declMatch ? declMatch.index + declMatch[0].lastIndexOf(identifier) : text.indexOf(identifier);
    if (index < 0) {
        return null;
    }
    return index;
}

function getQuickInfoText(quickInfo) {
    if (!quickInfo || !quickInfo.displayParts) {
        return "";
    }
    return ts.displayPartsToString(quickInfo.displayParts);
}

function getInlayHints(languageService, fileName, span, preferences) {
    if (typeof languageService.provideInlayHints === "function") {
        return languageService.provideInlayHints(fileName, span, preferences);
    }
    if (typeof languageService.getInlayHints === "function") {
        return languageService.getInlayHints(fileName, span, preferences);
    }
    return [];
}

function getInlayHintText(hint) {
    if (!hint) {
        return "";
    }
    if (typeof hint.text === "string") {
        return hint.text;
    }
    if (Array.isArray(hint.displayParts)) {
        return hint.displayParts.map((part) => part.text || "").join("");
    }
    return "";
}

function getDisplayPartsText(value) {
    if (!value) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((part) => (typeof part === "string" ? part : (part && part.text) || "")).join("");
    }
    return "";
}

function findMemberCompletionPosition(filePath, identifier) {
    const text = ts.sys.readFile(filePath) || "";
    const match = new RegExp(`\\b${identifier}\\s*\\.`).exec(text);
    if (!match) {
        return null;
    }
    const dotOffset = match[0].lastIndexOf(".");
    return match.index + dotOffset + 1;
}

function runTscCase(caseFolderArg) {
    const absoluteCaseFolder = path.resolve(caseFolderArg || path.join("test", "tsc-operators-all"));
    const projectPath = path.join(absoluteCaseFolder, "tsconfig.json");
    const outputFolder = path.join(absoluteCaseFolder, "dist");
    const expectedFile = path.join(absoluteCaseFolder, "expected.txt");
    const expectErrorFile = path.join(absoluteCaseFolder, "expect-error.txt");
    const expectsError = fs.existsSync(expectErrorFile);

    fs.rmSync(outputFolder, {recursive: true, force: true});

    const result = spawnSync(
        process.execPath,
        [path.resolve(__dirname, "build-tsc.cjs"), "--project", projectPath, "--outDir", outputFolder],
        {encoding: "utf8"}
    );

    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }

    if (expectsError) {
        const expectedErrorSnippet = readUtf8(expectErrorFile).trim();
        if (result.status === 0) {
            fail(`Expected compile error but build succeeded for ${absoluteCaseFolder}`);
        }
        if (expectedErrorSnippet && !(result.stderr || "").includes(expectedErrorSnippet)) {
            fail(`Expected error snippet not found for ${absoluteCaseFolder}: ${expectedErrorSnippet}`);
        }
        process.stdout.write(`Case passed (expected error): ${absoluteCaseFolder}\n`);
        return;
    }

    if (result.status !== 0) {
        fail(`Build failed for ${absoluteCaseFolder}`);
    }

    const outputJs = findFileRecursive(outputFolder, "main.js");
    if (!outputJs) {
        fail(`Could not find emitted main.js under ${outputFolder}`);
    }

    const expectedLines = readUtf8(expectedFile)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const output = readUtf8(outputJs);
    for (const expected of expectedLines) {
        if (!output.includes(expected)) {
            fail(`Expected snippet not found in ${outputJs}\nMissing snippet: ${expected}`);
        }
    }

    process.stdout.write(`Case passed: ${absoluteCaseFolder}\n`);
}

function runTscAll(rootArg) {
    const root = path.resolve(rootArg || "test");
    const caseFolders = collectCaseFolders(root).sort();

    if (caseFolders.length === 0) {
        fail(`No tsc cases found under ${root}`);
    }

    let failures = 0;
    for (const caseFolder of caseFolders) {
        try {
            runTscCase(caseFolder);
        } catch (error) {
            failures += 1;
            process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
        }
    }

    if (failures > 0) {
        fail(`Failed ${failures} tsc case(s).`);
    }

    process.stdout.write(`All ${caseFolders.length} tsc cases passed.\n`);
}

function runTsserverSmoke(projectRootArg) {
    const projectRoot = path.resolve(projectRootArg || path.join("test", "tsserver-smoke"));
    const projectPath = path.join(projectRoot, "tsconfig.json");
    const parsed = loadConfig(projectPath);
    const {languageService} = createLanguageService(parsed, projectRoot);

    const pluginFactory = createPlugin({typescript: ts});
    const pluginLanguageService = pluginFactory.create({
        languageService,
        languageServiceHost: null,
        config: {},
        project: {}
    });

    const overloadFile = path.join(projectRoot, "overload.ts");
    const noOverloadFile = path.join(projectRoot, "no-overload.ts");

    const rawOverloadDiagnostics = languageService.getSemanticDiagnostics(overloadFile);
    const rawNoOverloadDiagnostics = languageService.getSemanticDiagnostics(noOverloadFile);
    const pluginOverloadDiagnostics = pluginLanguageService.getSemanticDiagnostics(overloadFile);
    const pluginNoOverloadDiagnostics = pluginLanguageService.getSemanticDiagnostics(noOverloadFile);

    if (!hasOperatorError(rawOverloadDiagnostics)) {
        fail("Expected raw overload.ts diagnostics to contain an operator error.");
    }

    if (!hasOperatorError(rawNoOverloadDiagnostics)) {
        fail("Expected raw no-overload.ts diagnostics to contain an operator error.");
    }

    if (hasOperatorError(pluginOverloadDiagnostics)) {
        fail("Plugin should suppress overload.ts operator diagnostic, but it was still present.");
    }

    if (!hasOperatorError(pluginNoOverloadDiagnostics)) {
        fail("Plugin should keep no-overload.ts operator diagnostic, but it was removed.");
    }

    process.stdout.write("tsserver smoke passed: overload diagnostic suppressed, no-overload diagnostic preserved.\n");
}

function runTsserverProjectCheck(args) {
    const projectRoot = path.resolve(args[0] || ".");
    const targetFileArg = args[1] || "src/main.ts";
    const expectation = args[2] || "suppress";
    const pluginMode = args[3] || "suppress";
    const quickInfoIdentifier = args[4] || "";
    const quickInfoExpectedText = args[5] || "";
    const inlayIdentifier = args[6] || "";
    const inlayExpectedText = args[7] || "";
    const completionTargetIdentifier = args[8] || "";
    const completionEntryName = args[9] || "";
    const completionExpectedDetail = args[10] || "";

    const projectPath = path.join(projectRoot, "tsconfig.json");
    const targetFile = path.resolve(projectRoot, targetFileArg);

    const parsed = loadConfig(projectPath);
    const {languageService, host} = createLanguageService(parsed, projectRoot);

    const pluginFactory = createPlugin({typescript: ts});
    const pluginLanguageService = pluginFactory.create({
        languageService,
        languageServiceHost: host,
        config: {mode: pluginMode},
        project: {}
    });

    const rawDiagnostics = languageService.getSemanticDiagnostics(targetFile);
    const pluginDiagnostics = pluginLanguageService.getSemanticDiagnostics(targetFile);

    const rawHasOperator = hasOperatorError(rawDiagnostics);
    const pluginHasOperator = hasOperatorError(pluginDiagnostics);

    if (!rawHasOperator) {
        fail("Expected raw diagnostics to contain operator error.");
    }

    if (expectation === "suppress") {
        if (pluginHasOperator) {
            const lines = ["Expected plugin to suppress operator error, but it is still present."];
            for (const diag of pluginDiagnostics) {
                lines.push(formatDiagnostic(diag));
            }
            fail(lines.join("\n"));
        }
        process.stdout.write(`Plugin suppression check passed for ${targetFile}\n`);
    }

    if (expectation === "preserve") {
        if (!pluginHasOperator) {
            fail("Expected plugin to preserve operator error, but it was removed.");
        }
        process.stdout.write(`Plugin preserve check passed for ${targetFile}\n`);
    }

    if (expectation === "typed-ok") {
        if (pluginHasOperator) {
            const lines = ["Expected shadow mode to remove operator error for typed-ok check."];
            for (const diag of pluginDiagnostics) {
                lines.push(formatDiagnostic(diag));
            }
            fail(lines.join("\n"));
        }
        if (hasPropertyMissingError(pluginDiagnostics)) {
            const lines = ["Did not expect property-missing diagnostic (TS2339) in typed-ok check."];
            for (const diag of pluginDiagnostics) {
                lines.push(formatDiagnostic(diag));
            }
            fail(lines.join("\n"));
        }
        process.stdout.write(`Plugin typed-ok check passed for ${targetFile}\n`);
    } else if (expectation === "typed-error") {
        if (pluginHasOperator) {
            const lines = ["Expected shadow mode to remove operator error for typed-error check."];
            for (const diag of pluginDiagnostics) {
                lines.push(formatDiagnostic(diag));
            }
            fail(lines.join("\n"));
        }
        if (!hasPropertyMissingError(pluginDiagnostics)) {
            const lines = ["Expected property-missing diagnostic (TS2339) in typed-error check."];
            for (const diag of pluginDiagnostics) {
                lines.push(formatDiagnostic(diag));
            }
            fail(lines.join("\n"));
        }
        process.stdout.write(`Plugin typed-error check passed for ${targetFile}\n`);
    } else if (expectation !== "suppress" && expectation !== "preserve") {
        fail("Unknown expectation. Use suppress, preserve, typed-ok, or typed-error.");
    }

    if (quickInfoIdentifier && quickInfoExpectedText) {
        const position = findIdentifierPosition(targetFile, quickInfoIdentifier);
        if (position == null) {
            fail(`Could not find identifier for quick-info check: ${quickInfoIdentifier}`);
        }

        const quickInfo = pluginLanguageService.getQuickInfoAtPosition(targetFile, position);
        const quickInfoText = getQuickInfoText(quickInfo);
        if (!quickInfoText.includes(quickInfoExpectedText)) {
            fail(`Quick-info mismatch for ${quickInfoIdentifier}. Expected to include: ${quickInfoExpectedText}\nActual quick-info: ${quickInfoText || "<empty>"}`);
        }

        process.stdout.write(`Quick-info check passed for ${quickInfoIdentifier}: ${quickInfoText}\n`);
    }

    if (inlayIdentifier && inlayExpectedText) {
        const sourceText = ts.sys.readFile(targetFile) || "";
        const identifierPosition = findIdentifierPosition(targetFile, inlayIdentifier);
        if (identifierPosition == null) {
            fail(`Could not find identifier for inlay-hint check: ${inlayIdentifier}`);
        }

        const hints = getInlayHints(pluginLanguageService, targetFile, {start: 0, length: sourceText.length}, {
            includeInlayVariableTypeHints: true,
            includeInlayVariableTypeHintsWhenTypeMatchesName: true
        });

        const expectedHintPosition = identifierPosition + inlayIdentifier.length;
        const matchingHint = (hints || []).find((hint) => typeof hint.position === "number" && Math.abs(hint.position - expectedHintPosition) <= 1);
        const hintText = getInlayHintText(matchingHint);
        if (!matchingHint || !hintText.includes(inlayExpectedText)) {
            fail(`Inlay-hint mismatch for ${inlayIdentifier}. Expected to include: ${inlayExpectedText}\nActual hint: ${hintText || "<empty>"}`);
        }

        process.stdout.write(`Inlay-hint check passed for ${inlayIdentifier}: ${hintText}\n`);
    }

    if (completionTargetIdentifier && completionEntryName) {
        const completionPosition = findMemberCompletionPosition(targetFile, completionTargetIdentifier);
        if (completionPosition == null) {
            fail(`Could not find member access for completion check: ${completionTargetIdentifier}.`);
        }

        const completions = pluginLanguageService.getCompletionsAtPosition(targetFile, completionPosition, {
            includeInsertTextCompletions: true
        });
        const entry = (completions && completions.entries || []).find((item) => item.name === completionEntryName);
        if (!entry) {
            fail(`Completion entry not found on ${completionTargetIdentifier}.: ${completionEntryName}`);
        }

        if (completionExpectedDetail) {
            const details = pluginLanguageService.getCompletionEntryDetails(
                targetFile,
                completionPosition,
                completionEntryName,
                {},
                entry.source,
                {},
                entry.data
            );
            const detailText = getDisplayPartsText(details && details.displayParts);
            if (!detailText.includes(completionExpectedDetail)) {
                fail(`Completion detail mismatch for ${completionEntryName}. Expected to include: ${completionExpectedDetail}\nActual completion detail: ${detailText || "<empty>"}`);
            }
            process.stdout.write(`Completion detail check passed for ${completionTargetIdentifier}.${completionEntryName}: ${detailText}\n`);
        } else {
            process.stdout.write(`Completion check passed for ${completionTargetIdentifier}.${completionEntryName}\n`);
        }
    }
}

function runTsserverTyped(projectRootArg) {
    const projectRoot = path.resolve(projectRootArg || path.join("test", "tsserver-typed"));

    runTsserverProjectCheck([projectRoot, "smart-sub-return.ts", "typed-ok", "shadow", "a", "string", "a", "string"]);
    runTsserverProjectCheck([projectRoot, "eq-string-return.ts", "typed-ok", "shadow", "a", "string", "a", "string"]);
    runTsserverProjectCheck([projectRoot, "string-return.ts", "typed-ok", "shadow", "a", "string", "a", "string"]);
    runTsserverProjectCheck([projectRoot, "number-return.ts", "typed-error", "shadow", "a", "number", "a", "number"]);

    process.stdout.write("tsserver typed checks passed.\n");
}

function now() {
    return Date.now();
}

function runCommand(name, command, args) {
    const start = now();
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: "inherit",
        shell: true
    });
    const durationMs = now() - start;

    if (result.error) {
        return {
            name,
            ok: false,
            durationMs,
            detail: result.error.message
        };
    }

    return {
        name,
        ok: result.status === 0,
        durationMs,
        detail: result.status === 0 ? "ok" : `exit ${result.status}`
    };
}

function runInlineCheck(name, checkFn) {
    const start = now();
    try {
        checkFn();
        return {
            name,
            ok: true,
            durationMs: now() - start,
            detail: "ok"
        };
    } catch (error) {
        return {
            name,
            ok: false,
            durationMs: now() - start,
            detail: error && error.message ? error.message : String(error)
        };
    }
}

function formatMs(ms) {
    return `${(ms / 1000).toFixed(2)}s`;
}

async function runUnified() {
    const results = [];

    results.push(runInlineCheck("api-export-shape", () => {
        const root = require(path.join(repoRoot, "index.cjs"));
        if (typeof root.createTscTransformer !== "function") {
            throw new Error("root createTscTransformer export missing");
        }
        if (typeof root.createOperatorOverloadTransformer !== "function") {
            throw new Error("root createOperatorOverloadTransformer export missing");
        }
    }));

    const commandChecks = [
        ["eslint:install", ["--prefix", "test/eslint-basic", "install"]],
        ["eslint:lint", ["--prefix", "test/eslint-basic", "run", "lint"]],
        ["vite:install", ["--prefix", "test/vite-basic", "install"]],
        ["vite:build", ["--prefix", "test/vite-basic", "run", "build"]],
        ["nextjs:install", ["--prefix", "test/nextjs-basic", "install"]],
        ["nextjs:build", ["--prefix", "test/nextjs-basic", "run", "build"]]
    ];
    for (const [name, commandArgs] of commandChecks) {
        results.push(runCommand(name, npmCmd, commandArgs));
    }

    results.push(runInlineCheck("tsc-all", () => runTscAll("test")));
    results.push(runInlineCheck("tsserver-smoke", () => runTsserverSmoke(path.join("test", "tsserver-smoke"))));
    results.push(runInlineCheck("tsserver-typed", () => runTsserverTyped(path.join("test", "tsserver-typed"))));


    const totalMs = results.reduce((sum, item) => sum + item.durationMs, 0);
    const failed = results.filter((item) => !item.ok);

    process.stdout.write("\nUnified test summary\n");
    for (const item of results) {
        const status = item.ok ? "PASS" : "FAIL";
        process.stdout.write(`${status}  ${item.name}  (${formatMs(item.durationMs)})  ${item.detail}\n`);
    }
    process.stdout.write(`Total duration: ${formatMs(totalMs)}\n`);

    if (failed.length > 0) {
        fail(`Unified test failed: ${failed.length} check(s) failed.`);
    }

    process.stdout.write("Unified test passed: all checks succeeded.\n");
}

async function main() {
    await runUnified();
}

main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    process.exitCode = 1;
});

