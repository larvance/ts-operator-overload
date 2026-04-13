const ts = require("typescript");
const {
    resolveBinaryOperatorText,
    resolveUnaryOperatorText,
    resolveCompoundAssignmentText,
    resolveIncrementText
} = require("./operator-map.cjs");
const {
    isNumberLike,
    resolveBinaryAnnotatedMethod,
    resolveIncrementAnnotatedMethod,
    resolveUnaryAnnotatedMethod,
    resolveSmartBinaryFallback
} = require("./type-utils.cjs");

const SUPPRESSIBLE_OPERATOR_DIAGNOSTICS = new Set([2356, 2362, 2363, 2365, 2367]);

function nodeContainsPosition(node, position) {
    return node.pos <= position && position < node.end;
}

function findInnermostNodeAtPosition(sourceFile, position) {
    let result = sourceFile;

    function visit(node) {
        if (!nodeContainsPosition(node, position)) {
            return;
        }
        result = node;
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return result;
}

function findOperatorExpressionForDiagnostic(sourceFile, diagnostic) {
    if (typeof diagnostic.start !== "number") {
        return null;
    }

    let node = findInnermostNodeAtPosition(sourceFile, diagnostic.start);
    while (node) {
        if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
            return node;
        }
        node = node.parent;
    }
    return null;
}

function binaryHasApplicableOverload(binaryExpression, checker) {
    const assignmentText = resolveCompoundAssignmentText(binaryExpression.operatorToken.kind);
    if (assignmentText) {
        const leftType = checker.getTypeAtLocation(binaryExpression.left);
        const rightType = checker.getTypeAtLocation(binaryExpression.right);
        return !!resolveBinaryAnnotatedMethod(leftType, rightType, assignmentText, checker);
    }

    const operatorText = resolveBinaryOperatorText(binaryExpression.operatorToken.kind);
    if (!operatorText) {
        return false;
    }

    const leftType = checker.getTypeAtLocation(binaryExpression.left);
    const rightType = checker.getTypeAtLocation(binaryExpression.right);

    if (isNumberLike(leftType) && isNumberLike(rightType)) {
        return false;
    }

    if (resolveBinaryAnnotatedMethod(leftType, rightType, operatorText, checker)) {
        return true;
    }

    return !!resolveSmartBinaryFallback(leftType, rightType, operatorText, checker);
}

function unaryHasApplicableOverload(expression, checker) {
    if (ts.isPrefixUnaryExpression(expression)) {
        const incrementText = resolveIncrementText(expression.operator);
        if (incrementText) {
            const operandType = checker.getTypeAtLocation(expression.operand);
            if (resolveIncrementAnnotatedMethod(operandType, incrementText, checker)) {
                return true;
            }
        }

        const unaryText = resolveUnaryOperatorText(expression.operator);
        return !!(unaryText && resolveUnaryAnnotatedMethod(checker.getTypeAtLocation(expression.operand), unaryText, checker));
    }

    if (ts.isPostfixUnaryExpression(expression)) {
        const incrementText = resolveIncrementText(expression.operator);
        if (incrementText) {
            const operandType = checker.getTypeAtLocation(expression.operand);
            if (resolveIncrementAnnotatedMethod(operandType, incrementText, checker)) {
                return true;
            }
        }
        return false;
    }

    return false;
}

function shouldSuppressOperatorDiagnostic(diagnostic, program, options) {
    if (!diagnostic) {
        return false;
    }
    if (!diagnostic.file) {
        return false;
    }

    if (!SUPPRESSIBLE_OPERATOR_DIAGNOSTICS.has(diagnostic.code)) {
        return false;
    }

    const checker = program.getTypeChecker();
    const operatorExpression = findOperatorExpressionForDiagnostic(diagnostic.file, diagnostic);
    if (!operatorExpression) {
        return false;
    }

    if (ts.isBinaryExpression(operatorExpression)) {
        return binaryHasApplicableOverload(operatorExpression, checker);
    }

    return unaryHasApplicableOverload(operatorExpression, checker);
}

module.exports = {
    SUPPRESSIBLE_OPERATOR_DIAGNOSTICS,
    shouldSuppressOperatorDiagnostic
};

