const {createOperatorOverloadTransformer} = require("./core/create-transformer.cjs");
const {createTscTransformer} = require("./adapters/tsc/index.cjs");
const tsserverPlugin = require("./plugins/tsserver/index.cjs");
const {shouldSuppressOperatorDiagnostic} = require("./core/diagnostic-utils.cjs");

module.exports = {
    createOperatorOverloadTransformer,
    createTscTransformer,
    tsserverPlugin,
    shouldSuppressOperatorDiagnostic
};
