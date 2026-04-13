const {shouldSuppressOperatorDiagnostic} = require("../../core/diagnostic-utils.cjs");
const {getOperatorAnnotationDiagnosticsForFile} = require("../../core/annotation-diagnostics.cjs");
const {
    getShadowSemanticDiagnostics,
    getShadowQuickInfoAtPosition,
    getShadowCompletionsAtPosition,
    getShadowCompletionEntryDetails,
    getShadowInlayHints
} = require("./shadow-language-service.cjs");

function init(modules) {
    const ts = modules.typescript;

    function create(info) {
        const languageService = info.languageService;
        const proxy = Object.create(null);

        for (const key of Object.keys(languageService)) {
            const original = languageService[key];
            proxy[key] = typeof original === "function" ? original.bind(languageService) : original;
        }

        function getPluginOptions() {
            return {
                allowRightOperand: !!(info.config && info.config.allowRightOperand),
                mode: info.config && typeof info.config.mode === "string" ? info.config.mode : "suppress"
            };
        }

        proxy.getSemanticDiagnostics = (fileName) => {
            const pluginOptions = getPluginOptions();
            const program = languageService.getProgram();
            const annotationDiagnostics = program ? getOperatorAnnotationDiagnosticsForFile(program, fileName) : [];

            if (pluginOptions.mode === "shadow") {
                return getShadowSemanticDiagnostics(ts, info, fileName, pluginOptions).concat(annotationDiagnostics);
            }

            const diagnostics = languageService.getSemanticDiagnostics(fileName);
            if (!program) {
                return diagnostics.concat(annotationDiagnostics);
            }

            return diagnostics
                .filter((diagnostic) => !shouldSuppressOperatorDiagnostic(diagnostic, program, pluginOptions))
                .concat(annotationDiagnostics);
        };

        proxy.getQuickInfoAtPosition = (fileName, position) => {
            const pluginOptions = getPluginOptions();
            return getShadowQuickInfoAtPosition(ts, info, fileName, position, pluginOptions);
        };

        proxy.getCompletionsAtPosition = (fileName, position, preferences, triggerCharacter, triggerKind) => {
            const pluginOptions = getPluginOptions();
            if (pluginOptions.mode !== "shadow") {
                return languageService.getCompletionsAtPosition(fileName, position, preferences, triggerCharacter, triggerKind);
            }
            return getShadowCompletionsAtPosition(ts, info, fileName, position, pluginOptions, preferences, triggerCharacter, triggerKind);
        };

        proxy.getCompletionEntryDetails = (fileName, position, ...detailArgs) => {
            const pluginOptions = getPluginOptions();
            if (pluginOptions.mode !== "shadow") {
                return languageService.getCompletionEntryDetails(fileName, position, ...detailArgs);
            }
            return getShadowCompletionEntryDetails(ts, info, fileName, position, pluginOptions, detailArgs);
        };

        proxy.provideInlayHints = (fileName, span, preferences) => {
            const pluginOptions = getPluginOptions();
            if (pluginOptions.mode !== "shadow") {
                return typeof languageService.provideInlayHints === "function"
                    ? languageService.provideInlayHints(fileName, span, preferences)
                    : (typeof languageService.getInlayHints === "function" ? languageService.getInlayHints(fileName, span, preferences) : []);
            }
            return getShadowInlayHints(ts, info, fileName, span, pluginOptions, preferences);
        };

        proxy.getInlayHints = (fileName, span, preferences) => {
            const pluginOptions = getPluginOptions();
            if (pluginOptions.mode !== "shadow") {
                return typeof languageService.getInlayHints === "function"
                    ? languageService.getInlayHints(fileName, span, preferences)
                    : (typeof languageService.provideInlayHints === "function" ? languageService.provideInlayHints(fileName, span, preferences) : []);
            }
            return getShadowInlayHints(ts, info, fileName, span, pluginOptions, preferences);
        };

        return proxy;
    }

    return {create};
}

module.exports = init;
