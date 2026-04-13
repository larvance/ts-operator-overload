const {shouldSuppressOperatorDiagnostic} = require("../../core/diagnostic-utils.cjs");
const {getOperatorAnnotationDiagnosticsForFile} = require("../../core/annotation-diagnostics.cjs");
const {
    getShadowSemanticDiagnostics,
    getShadowQuickInfoAtPosition,
    getShadowCompletionsAtPosition,
    getShadowCompletionEntryDetails,
    getShadowInlayHints
} = require("./shadow-language-service.cjs");
const {createHybridCoordinator} = require("./hybrid-coordinator.cjs");

function init(modules) {
    const ts = modules.typescript;

    function create(info) {
        const languageService = info.languageService;
        const hybridCoordinator = createHybridCoordinator(ts, info);
        const proxy = Object.create(null);

        for (const key of Object.keys(languageService)) {
            const original = languageService[key];
            proxy[key] = typeof original === "function" ? original.bind(languageService) : original;
        }

        function parseFeatureConfig(configValue, defaultDiagnostics) {
            if (!configValue || typeof configValue !== "object") {
                return {
                    diagnostics: defaultDiagnostics,
                    quickInfo: true,
                    completions: true,
                    completionDetails: true,
                    inlayHints: true
                };
            }

            const raw = configValue;
            return {
                diagnostics: defaultDiagnostics ? raw.diagnostics !== false : raw.diagnostics === true,
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
                shadowFeatures: parseFeatureConfig(info.config && info.config.shadowFeatures, true),
                hybridFeatures: parseFeatureConfig(info.config && info.config.hybridWarmOn, false),
                hybridDebounceMs: Number(info.config && info.config.hybridDebounceMs),
                hybridMaxBuildMs: Number(info.config && info.config.hybridMaxBuildMs),
                hybridFailureDisableAfter: Number(info.config && info.config.hybridFailureDisableAfter),
                hybridCooldownMs: Number(info.config && info.config.hybridCooldownMs)
            };
        }

        function canUseShadowRuntime(pluginOptions) {
            if (pluginOptions.mode !== "shadow" && pluginOptions.mode !== "hybrid") {
                return false;
            }
            if (!pluginOptions.autoFallbackToSuppress || pluginOptions.maxShadowFiles <= 0) {
                return true;
            }

            const host = info.languageServiceHost;
            const fileNames = host && typeof host.getScriptFileNames === "function" ? host.getScriptFileNames() : [];
            return fileNames.length <= pluginOptions.maxShadowFiles;
        }

        function getBaseInlayHints(fileName, span, preferences) {
            return typeof languageService.getInlayHints === "function"
                ? languageService.getInlayHints(fileName, span, preferences)
                : (typeof languageService.provideInlayHints === "function" ? languageService.provideInlayHints(fileName, span, preferences) : []);
        }

        proxy.getSemanticDiagnostics = (fileName) => {
            const pluginOptions = getPluginOptions();
            const useShadowRuntime = canUseShadowRuntime(pluginOptions);
            const program = languageService.getProgram();
            const annotationDiagnostics = program ? getOperatorAnnotationDiagnosticsForFile(program, fileName) : [];

            if (pluginOptions.mode === "shadow" && useShadowRuntime && pluginOptions.shadowFeatures.diagnostics) {
                return getShadowSemanticDiagnostics(ts, info, fileName, pluginOptions).concat(annotationDiagnostics);
            }

            if (pluginOptions.mode === "hybrid" && useShadowRuntime) {
                hybridCoordinator.scheduleWarmup(fileName, pluginOptions);
                if (pluginOptions.hybridFeatures.diagnostics && hybridCoordinator.canServeFromShadow(fileName, pluginOptions)) {
                    return getShadowSemanticDiagnostics(ts, info, fileName, pluginOptions).concat(annotationDiagnostics);
                }
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
            const useShadowRuntime = canUseShadowRuntime(pluginOptions);
            if (!useShadowRuntime) {
                return languageService.getQuickInfoAtPosition(fileName, position);
            }

            if (pluginOptions.mode === "shadow") {
                if (!pluginOptions.shadowFeatures.quickInfo) {
                    return languageService.getQuickInfoAtPosition(fileName, position);
                }
                return getShadowQuickInfoAtPosition(ts, info, fileName, position, pluginOptions);
            }

            hybridCoordinator.scheduleWarmup(fileName, pluginOptions);
            if (!pluginOptions.hybridFeatures.quickInfo || !hybridCoordinator.canServeFromShadow(fileName, pluginOptions)) {
                return languageService.getQuickInfoAtPosition(fileName, position);
            }
            return getShadowQuickInfoAtPosition(ts, info, fileName, position, pluginOptions);
        };

        proxy.getCompletionsAtPosition = (fileName, position, preferences, triggerCharacter, triggerKind) => {
            const pluginOptions = getPluginOptions();
            const useShadowRuntime = canUseShadowRuntime(pluginOptions);
            if (!useShadowRuntime) {
                return languageService.getCompletionsAtPosition(fileName, position, preferences, triggerCharacter, triggerKind);
            }

            if (pluginOptions.mode === "shadow") {
                if (!pluginOptions.shadowFeatures.completions) {
                    return languageService.getCompletionsAtPosition(fileName, position, preferences, triggerCharacter, triggerKind);
                }
                return getShadowCompletionsAtPosition(ts, info, fileName, position, pluginOptions, preferences, triggerCharacter, triggerKind);
            }

            hybridCoordinator.scheduleWarmup(fileName, pluginOptions);
            if (!pluginOptions.hybridFeatures.completions || !hybridCoordinator.canServeFromShadow(fileName, pluginOptions)) {
                return languageService.getCompletionsAtPosition(fileName, position, preferences, triggerCharacter, triggerKind);
            }
            return getShadowCompletionsAtPosition(ts, info, fileName, position, pluginOptions, preferences, triggerCharacter, triggerKind);
        };

        proxy.getCompletionEntryDetails = (fileName, position, ...detailArgs) => {
            const pluginOptions = getPluginOptions();
            const useShadowRuntime = canUseShadowRuntime(pluginOptions);
            if (!useShadowRuntime) {
                return languageService.getCompletionEntryDetails(fileName, position, ...detailArgs);
            }

            if (pluginOptions.mode === "shadow") {
                if (!pluginOptions.shadowFeatures.completionDetails) {
                    return languageService.getCompletionEntryDetails(fileName, position, ...detailArgs);
                }
                return getShadowCompletionEntryDetails(ts, info, fileName, position, pluginOptions, detailArgs);
            }

            hybridCoordinator.scheduleWarmup(fileName, pluginOptions);
            if (!pluginOptions.hybridFeatures.completionDetails || !hybridCoordinator.canServeFromShadow(fileName, pluginOptions)) {
                return languageService.getCompletionEntryDetails(fileName, position, ...detailArgs);
            }
            return getShadowCompletionEntryDetails(ts, info, fileName, position, pluginOptions, detailArgs);
        };

        proxy.provideInlayHints = (fileName, span, preferences) => {
            const pluginOptions = getPluginOptions();
            const useShadowRuntime = canUseShadowRuntime(pluginOptions);
            if (!useShadowRuntime) {
                return typeof languageService.provideInlayHints === "function"
                    ? languageService.provideInlayHints(fileName, span, preferences)
                    : getBaseInlayHints(fileName, span, preferences);
            }

            if (pluginOptions.mode === "shadow") {
                if (!pluginOptions.shadowFeatures.inlayHints) {
                    return typeof languageService.provideInlayHints === "function"
                        ? languageService.provideInlayHints(fileName, span, preferences)
                        : getBaseInlayHints(fileName, span, preferences);
                }
                return getShadowInlayHints(ts, info, fileName, span, pluginOptions, preferences);
            }

            hybridCoordinator.scheduleWarmup(fileName, pluginOptions);
            if (!pluginOptions.hybridFeatures.inlayHints || !hybridCoordinator.canServeFromShadow(fileName, pluginOptions)) {
                return typeof languageService.provideInlayHints === "function"
                    ? languageService.provideInlayHints(fileName, span, preferences)
                    : getBaseInlayHints(fileName, span, preferences);
            }
            return getShadowInlayHints(ts, info, fileName, span, pluginOptions, preferences);
        };

        proxy.getInlayHints = (fileName, span, preferences) => {
            const pluginOptions = getPluginOptions();
            const useShadowRuntime = canUseShadowRuntime(pluginOptions);
            if (!useShadowRuntime) {
                return getBaseInlayHints(fileName, span, preferences);
            }

            if (pluginOptions.mode === "shadow") {
                if (!pluginOptions.shadowFeatures.inlayHints) {
                    return getBaseInlayHints(fileName, span, preferences);
                }
                return getShadowInlayHints(ts, info, fileName, span, pluginOptions, preferences);
            }

            hybridCoordinator.scheduleWarmup(fileName, pluginOptions);
            if (!pluginOptions.hybridFeatures.inlayHints || !hybridCoordinator.canServeFromShadow(fileName, pluginOptions)) {
                return getBaseInlayHints(fileName, span, preferences);
            }
            return getShadowInlayHints(ts, info, fileName, span, pluginOptions, preferences);
        };

        return proxy;
    }

    return {create};
}

module.exports = init;
