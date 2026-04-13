const api = require("./src/index.cjs");
const tsserverPlugin = require("./src/plugins/tsserver/index.cjs");

const exported = tsserverPlugin;

Object.assign(exported, api);

module.exports = exported;
