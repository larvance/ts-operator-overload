const ts = require("typescript");

const DEFAULT_BINARY_OPERATOR_TO_TEXT = new Map([
    [ts.SyntaxKind.PlusToken, "+"],
    [ts.SyntaxKind.MinusToken, "-"],
    [ts.SyntaxKind.AsteriskToken, "*"],
    [ts.SyntaxKind.SlashToken, "/"],
    [ts.SyntaxKind.PercentToken, "%"],
    [ts.SyntaxKind.AsteriskAsteriskToken, "**"],
    [ts.SyntaxKind.EqualsEqualsToken, "=="],
    [ts.SyntaxKind.ExclamationEqualsToken, "!="],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "==="],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
    [ts.SyntaxKind.GreaterThanToken, ">"],
    [ts.SyntaxKind.GreaterThanEqualsToken, ">="],
    [ts.SyntaxKind.LessThanToken, "<"],
    [ts.SyntaxKind.LessThanEqualsToken, "<="],
    [ts.SyntaxKind.AmpersandAmpersandToken, "&&"],
    [ts.SyntaxKind.BarBarToken, "||"],
    [ts.SyntaxKind.QuestionQuestionToken, "??"],
    [ts.SyntaxKind.AmpersandToken, "&"],
    [ts.SyntaxKind.BarToken, "|"],
    [ts.SyntaxKind.CaretToken, "^"],
    [ts.SyntaxKind.LessThanLessThanToken, "<<"],
    [ts.SyntaxKind.GreaterThanGreaterThanToken, ">>"],
    [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, ">>>"]
]);

const DEFAULT_UNARY_OPERATOR_TO_TEXT = new Map([
    [ts.SyntaxKind.PlusToken, "+"],
    [ts.SyntaxKind.MinusToken, "-"],
    [ts.SyntaxKind.ExclamationToken, "!"],
    [ts.SyntaxKind.TildeToken, "~"]
]);

const DEFAULT_COMPOUND_ASSIGN_TO_TEXT = new Map([
    [ts.SyntaxKind.PlusEqualsToken, "+"],
    [ts.SyntaxKind.MinusEqualsToken, "-"],
    [ts.SyntaxKind.AsteriskEqualsToken, "*"],
    [ts.SyntaxKind.SlashEqualsToken, "/"],
    [ts.SyntaxKind.PercentEqualsToken, "%"],
    [ts.SyntaxKind.AsteriskAsteriskEqualsToken, "**"],
    [ts.SyntaxKind.AmpersandAmpersandEqualsToken, "&&"],
    [ts.SyntaxKind.BarBarEqualsToken, "||"],
    [ts.SyntaxKind.QuestionQuestionEqualsToken, "??"],
    [ts.SyntaxKind.AmpersandEqualsToken, "&"],
    [ts.SyntaxKind.BarEqualsToken, "|"],
    [ts.SyntaxKind.CaretEqualsToken, "^"],
    [ts.SyntaxKind.LessThanLessThanEqualsToken, "<<"],
    [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ">>"],
    [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ">>>"]
]);

const DEFAULT_INCREMENT_TO_TEXT = new Map([
    [ts.SyntaxKind.PlusPlusToken, "+"],
    [ts.SyntaxKind.MinusMinusToken, "-"]
]);

function resolveBinaryOperatorText(kind) {
    return DEFAULT_BINARY_OPERATOR_TO_TEXT.get(kind) || null;
}

function resolveUnaryOperatorText(kind) {
    return DEFAULT_UNARY_OPERATOR_TO_TEXT.get(kind) || null;
}

function resolveCompoundAssignmentText(kind) {
    return DEFAULT_COMPOUND_ASSIGN_TO_TEXT.get(kind) || null;
}

function resolveIncrementText(kind) {
    return DEFAULT_INCREMENT_TO_TEXT.get(kind) || null;
}

module.exports = {
    DEFAULT_BINARY_OPERATOR_TO_TEXT,
    DEFAULT_UNARY_OPERATOR_TO_TEXT,
    DEFAULT_COMPOUND_ASSIGN_TO_TEXT,
    DEFAULT_INCREMENT_TO_TEXT,
    resolveBinaryOperatorText,
    resolveUnaryOperatorText,
    resolveCompoundAssignmentText,
    resolveIncrementText
};

