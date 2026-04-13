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

function getBooleanTypeFromChecker(checker) {
    return typeof checker.getBooleanType === "function" ? checker.getBooleanType() : null;
}

function getEffectiveExpressionType(node, checker) {
    if (!node) {
        return null;
    }

    if (ts.isParenthesizedExpression(node)) {
        return getEffectiveExpressionType(node.expression, checker);
    }

    if (ts.isBinaryExpression(node)) {
        const assignmentText = resolveCompoundAssignmentText(node.operatorToken.kind);
        if (assignmentText) {
            return getEffectiveExpressionType(node.left, checker) || checker.getTypeAtLocation(node.left);
        }

        const operatorText = resolveBinaryOperatorText(node.operatorToken.kind);
        if (!operatorText) {
            return checker.getTypeAtLocation(node);
        }

        const leftType = getEffectiveExpressionType(node.left, checker) || checker.getTypeAtLocation(node.left);
        const rightType = getEffectiveExpressionType(node.right, checker) || checker.getTypeAtLocation(node.right);

        if (isNumberLike(leftType) && isNumberLike(rightType)) {
            return checker.getTypeAtLocation(node);
        }

        const resolvedBinary = resolveBinaryAnnotatedMethod(leftType, rightType, operatorText, checker);
        if (resolvedBinary && resolvedBinary.returnType) {
            return resolvedBinary.returnType;
        }

        const smartFallback = resolveSmartBinaryFallback(leftType, rightType, operatorText, checker);
        if (smartFallback && smartFallback.kind === "negate-binary") {
            return getBooleanTypeFromChecker(checker) || checker.getTypeAtLocation(node);
        }
        if (smartFallback && smartFallback.addResolved && smartFallback.addResolved.returnType) {
            return smartFallback.addResolved.returnType;
        }

        return checker.getTypeAtLocation(node);
    }

    if (ts.isPrefixUnaryExpression(node)) {
        const incrementText = resolveIncrementText(node.operator);
        if (incrementText) {
            return getEffectiveExpressionType(node.operand, checker) || checker.getTypeAtLocation(node.operand);
        }

        const unaryText = resolveUnaryOperatorText(node.operator);
        if (!unaryText) {
            return checker.getTypeAtLocation(node);
        }

        const operandType = getEffectiveExpressionType(node.operand, checker) || checker.getTypeAtLocation(node.operand);
        const resolvedUnary = resolveUnaryAnnotatedMethod(operandType, unaryText, checker);
        if (resolvedUnary && resolvedUnary.returnType) {
            return resolvedUnary.returnType;
        }
        if (node.operator === ts.SyntaxKind.ExclamationToken) {
            return getBooleanTypeFromChecker(checker) || checker.getTypeAtLocation(node);
        }
        return checker.getTypeAtLocation(node);
    }

    if (ts.isPostfixUnaryExpression(node)) {
        const incrementText = resolveIncrementText(node.operator);
        if (incrementText) {
            return getEffectiveExpressionType(node.operand, checker) || checker.getTypeAtLocation(node.operand);
        }
    }

    return checker.getTypeAtLocation(node);
}

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
        const leftType = getEffectiveExpressionType(binaryExpression.left, checker) || checker.getTypeAtLocation(binaryExpression.left);
        const rightType = getEffectiveExpressionType(binaryExpression.right, checker) || checker.getTypeAtLocation(binaryExpression.right);
        return !!resolveBinaryAnnotatedMethod(leftType, rightType, assignmentText, checker);
    }

    const operatorText = resolveBinaryOperatorText(binaryExpression.operatorToken.kind);
    if (!operatorText) {
        return false;
    }

    const leftType = getEffectiveExpressionType(binaryExpression.left, checker) || checker.getTypeAtLocation(binaryExpression.left);
    const rightType = getEffectiveExpressionType(binaryExpression.right, checker) || checker.getTypeAtLocation(binaryExpression.right);

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
            const operandType = getEffectiveExpressionType(expression.operand, checker) || checker.getTypeAtLocation(expression.operand);
            if (resolveIncrementAnnotatedMethod(operandType, incrementText, checker)) {
                return true;
            }
        }

        const unaryText = resolveUnaryOperatorText(expression.operator);
        const operandType = getEffectiveExpressionType(expression.operand, checker) || checker.getTypeAtLocation(expression.operand);
        return !!(unaryText && resolveUnaryAnnotatedMethod(operandType, unaryText, checker));
    }

    if (ts.isPostfixUnaryExpression(expression)) {
        const incrementText = resolveIncrementText(expression.operator);
        if (incrementText) {
            const operandType = getEffectiveExpressionType(expression.operand, checker) || checker.getTypeAtLocation(expression.operand);
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

