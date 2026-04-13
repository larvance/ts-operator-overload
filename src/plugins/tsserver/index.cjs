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

        function parseShadowFeatures(config) {
            if (!config || typeof config.shadowFeatures !== "object" || config.shadowFeatures === null) {
                return {
                    diagnostics: true,
                    quickInfo: true,
                    completions: true,
                    completionDetails: true,
                    inlayHints: true
                };
            }

            const raw = config.shadowFeatures;
            return {
                diagnostics: raw.diagnostics !== false,
                quickInfo: raw.quickInfo !== false,
                completions: raw.completions !== false,
                completionDetails: raw.completionDetails !== false,
                inlayHints: raw.inlayHints !== false
            };
        }

        function getPluginOptions() {
            const maxShadowFiles = Number(info.config && info.config.maxShadowFiles);
            return {
                allowRightOperand: !!(info.config && info.config.allowRightOperand),
                mode: info.config && typeof info.config.mode === "string" ? info.config.mode : "suppress",
                shadowScope: info.config && info.config.shadowScope === "project" ? "project" : "file",
                autoFallbackToSuppress: !info.config || info.config.autoFallbackToSuppress !== false,
                maxShadowFiles: Number.isFinite(maxShadowFiles) && maxShadowFiles > 0 ? maxShadowFiles : 0,
                shadowFeatures: parseShadowFeatures(info.config)
            };
        }

        function canUseShadow(pluginOptions) {
            if (pluginOptions.mode !== "shadow") {
                return false;
            }
            if (!pluginOptions.autoFallbackToSuppress || pluginOptions.maxShadowFiles <= 0) {
                return true;
            }

            const host = info.languageServiceHost;
            const fileNames = host && typeof host.getScriptFileNames === "function" ? host.getScriptFileNames() : [];
            return fileNames.length <= pluginOptions.maxShadowFiles;
        }

        proxy.getSemanticDiagnostics = (fileName) => {
            const pluginOptions = getPluginOptions();
            const useShadow = canUseShadow(pluginOptions);
            const program = languageService.getProgram();
            const annotationDiagnostics = program ? getOperatorAnnotationDiagnosticsForFile(program, fileName) : [];

            if (useShadow && pluginOptions.shadowFeatures.diagnostics) {
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
            if (!canUseShadow(pluginOptions) || !pluginOptions.shadowFeatures.quickInfo) {
                return languageService.getQuickInfoAtPosition(fileName, position);
            }
            return getShadowQuickInfoAtPosition(ts, info, fileName, position, pluginOptions);
        };

        proxy.getCompletionsAtPosition = (fileName, position, preferences, triggerCharacter, triggerKind) => {
            const pluginOptions = getPluginOptions();
            if (!canUseShadow(pluginOptions) || !pluginOptions.shadowFeatures.completions) {
                return languageService.getCompletionsAtPosition(fileName, position, preferences, triggerCharacter, triggerKind);
            }
            return getShadowCompletionsAtPosition(ts, info, fileName, position, pluginOptions, preferences, triggerCharacter, triggerKind);
        };

        proxy.getCompletionEntryDetails = (fileName, position, ...detailArgs) => {
            const pluginOptions = getPluginOptions();
            if (!canUseShadow(pluginOptions) || !pluginOptions.shadowFeatures.completionDetails) {
                return languageService.getCompletionEntryDetails(fileName, position, ...detailArgs);
            }
            return getShadowCompletionEntryDetails(ts, info, fileName, position, pluginOptions, detailArgs);
        };

        proxy.provideInlayHints = (fileName, span, preferences) => {
            const pluginOptions = getPluginOptions();
            if (!canUseShadow(pluginOptions) || !pluginOptions.shadowFeatures.inlayHints) {
                return typeof languageService.provideInlayHints === "function"
                    ? languageService.provideInlayHints(fileName, span, preferences)
                    : (typeof languageService.getInlayHints === "function" ? languageService.getInlayHints(fileName, span, preferences) : []);
            }
            return getShadowInlayHints(ts, info, fileName, span, pluginOptions, preferences);
        };

        proxy.getInlayHints = (fileName, span, preferences) => {
            const pluginOptions = getPluginOptions();
            if (!canUseShadow(pluginOptions) || !pluginOptions.shadowFeatures.inlayHints) {
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
