const {getExistingShadowContext, warmShadowContext} = require("./shadow-language-service.cjs");

const stateByHost = new WeakMap();

function normalizePath(fileName) {
    return String(fileName || "").replace(/\\/g, "/").toLowerCase();
}

function getOptionsStamp(options) {
    const shadowScope = options && options.shadowScope === "project" ? "project" : "file";
    return `${options && options.allowRightOperand ? "1" : "0"}:${shadowScope}`;
}

function getVersionStamp(info, fileName, options) {
    const host = info.languageServiceHost;
    if (!host) {
        return "none";
    }

    const scope = options && options.shadowScope === "project" ? "project" : "file";
    if (scope === "project" && typeof host.getProjectVersion === "function") {
        return `p:${host.getProjectVersion() || "0"}`;
    }

    if (typeof host.getScriptVersion === "function") {
        return `f:${normalizePath(fileName)}:${host.getScriptVersion(fileName) || "0"}`;
    }

    return `f:${normalizePath(fileName)}:0`;
}

function getRequestKey(info, fileName, options) {
    return `${getOptionsStamp(options)}:${getVersionStamp(info, fileName, options)}`;
}

function getState(info) {
    const host = info.languageServiceHost || info.languageService;
    let state = stateByHost.get(host);
    if (!state) {
        state = {
            timer: null,
            seq: 0,
            pendingKey: "",
            readyKey: "",
            consecutiveFailures: 0,
            disabledUntil: 0
        };
        stateByHost.set(host, state);
    }
    return state;
}

function createHybridCoordinator(tsModule, info) {
    function scheduleWarmup(fileName, options) {
        const state = getState(info);
        const debounceMs = Number(options && options.hybridDebounceMs);
        const effectiveDebounceMs = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : 800;
        const failureDisableAfter = Number(options && options.hybridFailureDisableAfter);
        const effectiveFailureDisableAfter = Number.isFinite(failureDisableAfter) && failureDisableAfter > 0 ? failureDisableAfter : 5;
        const cooldownMs = Number(options && options.hybridCooldownMs);
        const effectiveCooldownMs = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 15000;
        const maxBuildMs = Number(options && options.hybridMaxBuildMs);
        const effectiveMaxBuildMs = Number.isFinite(maxBuildMs) && maxBuildMs > 0 ? maxBuildMs : 0;

        if (Date.now() < state.disabledUntil) {
            return;
        }

        const targetKey = getRequestKey(info, fileName, options);
        if (state.readyKey === targetKey) {
            return;
        }

        state.pendingKey = targetKey;
        state.seq += 1;
        const jobId = state.seq;

        if (state.timer) {
            clearTimeout(state.timer);
        }

        state.timer = setTimeout(() => {
            if (jobId !== state.seq) {
                return;
            }
            if (Date.now() < state.disabledUntil) {
                return;
            }

            const startedAt = Date.now();
            try {
                warmShadowContext(tsModule, info, options, fileName);
                const durationMs = Date.now() - startedAt;
                if (effectiveMaxBuildMs > 0 && durationMs > effectiveMaxBuildMs) {
                    throw new Error(`shadow warmup exceeded budget (${durationMs}ms > ${effectiveMaxBuildMs}ms)`);
                }

                if (jobId !== state.seq) {
                    return;
                }

                state.readyKey = targetKey;
                state.consecutiveFailures = 0;
            } catch (_error) {
                state.readyKey = "";
                state.consecutiveFailures += 1;
                if (state.consecutiveFailures >= effectiveFailureDisableAfter) {
                    state.disabledUntil = Date.now() + effectiveCooldownMs;
                    state.consecutiveFailures = 0;
                }
            }
        }, effectiveDebounceMs);
    }

    function canServeFromShadow(fileName, options) {
        const state = getState(info);
        const key = getRequestKey(info, fileName, options);
        if (state.readyKey !== key) {
            return false;
        }
        return !!getExistingShadowContext(tsModule, info, options, fileName);
    }

    function dispose() {
        const state = getState(info);
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
    }

    return {
        scheduleWarmup,
        canServeFromShadow,
        dispose
    };
}

module.exports = {
    createHybridCoordinator
};

