const path = require("path");
const ts = require("typescript");
const {createTscTransformer} = require("../src/adapters/tsc/index.cjs");
const {shouldSuppressOperatorDiagnostic} = require("../src/core/diagnostic-utils.cjs");
const {getOperatorAnnotationDiagnosticsForSourceFile} = require("../src/core/annotation-diagnostics.cjs");

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith("--")) {
            continue;
        }
        const key = token.slice(2);
        args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    }
    return args;
}

function loadConfig(projectPath) {
    const configFile = ts.readConfigFile(projectPath, ts.sys.readFile);
    if (configFile.error) {
        return {error: configFile.error};
    }
    const configDir = path.dirname(projectPath);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir);
    if (parsed.errors && parsed.errors.length > 0) {
        return {error: parsed.errors[0]};
    }
    return {parsed};
}

function formatDiagnostics(diags) {
    const host = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine
    };
    return ts.formatDiagnosticsWithColorAndContext(diags, host);
}

function run() {
    const args = parseArgs(process.argv);
    const project = path.resolve(args.project || "tsconfig.json");
    const loaded = loadConfig(project);

    if (loaded.error) {
        process.stderr.write(formatDiagnostics([loaded.error]));
        process.exitCode = 1;
        return;
    }

    const parsed = loaded.parsed;
    const compilerOptions = {...parsed.options};
    if (args.outDir) {
        compilerOptions.outDir = path.resolve(args.outDir);
    }

    const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: compilerOptions,
        projectReferences: parsed.projectReferences
    });

    const emitResult = program.emit(
        undefined,
        undefined,
        undefined,
        undefined,
        {
            before: [createTscTransformer(program)]
        }
    );

    const annotationDiagnostics = [];
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile) {
            continue;
        }
        annotationDiagnostics.push(...getOperatorAnnotationDiagnosticsForSourceFile(program, sourceFile));
    }

    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics, annotationDiagnostics);
    const hardDiagnostics = allDiagnostics.filter((diag) => {
        if (diag.category !== ts.DiagnosticCategory.Error) {
            return false;
        }
        return !shouldSuppressOperatorDiagnostic(diag, program, {allowRightOperand: false});
    });

    const visibleDiagnostics = allDiagnostics.filter((diag) => {
        if (diag.category !== ts.DiagnosticCategory.Error) {
            return true;
        }
        return hardDiagnostics.includes(diag);
    });

    if (visibleDiagnostics.length > 0) {
        process.stderr.write(formatDiagnostics(visibleDiagnostics));
    }

    process.exitCode = emitResult.emitSkipped || hardDiagnostics.length > 0 ? 1 : 0;
}

run();
