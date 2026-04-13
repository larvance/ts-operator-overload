const {createOperatorOverloadTransformer} = require("../../core/create-transformer.cjs");

function createTscTransformer(program, options) {
    return createOperatorOverloadTransformer(program, options);
}

module.exports = {
    createTscTransformer
};

