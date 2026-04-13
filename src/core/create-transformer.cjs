const ts = require("typescript");
const {
    resolveBinaryOperatorText,
    resolveUnaryOperatorText,
    resolveCompoundAssignmentText,
    resolveIncrementText
} = require("./operator-map.cjs");
const {
    isNumberLike,
    resolveUnaryAnnotatedMethod,
    resolveBinaryAnnotatedMethod,
    resolveIncrementAnnotatedMethod,
    resolveSmartBinaryFallback
} = require("./type-utils.cjs");

function createOperatorOverloadTransformer(program, _options) {
    const checker = program.getTypeChecker();

    return function transformerFactory(context) {
        const {factory} = context;

        function createResolvedCallTarget(expressionNode, resolved) {
            if (resolved && resolved.invokeKind === "static" && resolved.ownerName) {
                return factory.createPropertyAccessExpression(
                    factory.createIdentifier(resolved.ownerName),
                    factory.createIdentifier(resolved.methodName)
                );
            }
            return factory.createPropertyAccessExpression(expressionNode, factory.createIdentifier(resolved.methodName));
        }

        function createResolvedUnaryCallExpression(operand, resolvedUnary) {
            const target = factory.createPropertyAccessExpression(operand, factory.createIdentifier(resolvedUnary.methodName));
            if (resolvedUnary.arity === 0) {
                return factory.createCallExpression(target, undefined, []);
            }
            return factory.createCallExpression(target, undefined, [operand]);
        }

        function createResolvedBinaryCallExpression(left, right, resolvedBinary) {
            const targetExpression = resolvedBinary.side === "right" ? right : left;
            const target = createResolvedCallTarget(targetExpression, resolvedBinary);
            if (resolvedBinary.arity === 1) {
                return factory.createCallExpression(target, undefined, [right]);
            }
            return factory.createCallExpression(target, undefined, [left, right]);
        }

        function getOriginalNode(node) {
            return node && node.original ? node.original : node;
        }

        function getBooleanType() {
            return typeof checker.getBooleanType === "function" ? checker.getBooleanType() : null;
        }

        function getEffectiveExpressionType(node) {
            if (!node) {
                return null;
            }

            if (ts.isParenthesizedExpression(node)) {
                return getEffectiveExpressionType(node.expression);
            }

            if (ts.isBinaryExpression(node)) {
                const assignmentText = resolveCompoundAssignmentText(node.operatorToken.kind);
                if (assignmentText) {
                    return getEffectiveExpressionType(node.left) || checker.getTypeAtLocation(node.left);
                }

                const operatorText = resolveBinaryOperatorText(node.operatorToken.kind);
                if (!operatorText) {
                    return checker.getTypeAtLocation(node);
                }

                const leftType = getEffectiveExpressionType(node.left) || checker.getTypeAtLocation(node.left);
                const rightType = getEffectiveExpressionType(node.right) || checker.getTypeAtLocation(node.right);

                if (isNumberLike(leftType) && isNumberLike(rightType)) {
                    return checker.getTypeAtLocation(node);
                }

                const resolvedBinary = resolveBinaryAnnotatedMethod(leftType, rightType, operatorText, checker);
                if (resolvedBinary && resolvedBinary.returnType) {
                    return resolvedBinary.returnType;
                }

                const smartFallback = resolveSmartBinaryFallback(leftType, rightType, operatorText, checker);
                if (smartFallback && smartFallback.kind === "negate-binary") {
                    return getBooleanType() || checker.getTypeAtLocation(node);
                }
                if (smartFallback && smartFallback.addResolved && smartFallback.addResolved.returnType) {
                    return smartFallback.addResolved.returnType;
                }

                return checker.getTypeAtLocation(node);
            }

            if (ts.isPrefixUnaryExpression(node)) {
                const incrementText = resolveIncrementText(node.operator);
                if (incrementText) {
                    return getEffectiveExpressionType(node.operand) || checker.getTypeAtLocation(node.operand);
                }

                const operatorText = resolveUnaryOperatorText(node.operator);
                if (!operatorText) {
                    return checker.getTypeAtLocation(node);
                }

                const operandType = getEffectiveExpressionType(node.operand) || checker.getTypeAtLocation(node.operand);
                const resolvedUnary = resolveUnaryAnnotatedMethod(operandType, operatorText, checker);
                if (resolvedUnary && resolvedUnary.returnType) {
                    return resolvedUnary.returnType;
                }
                if (node.operator === ts.SyntaxKind.ExclamationToken) {
                    return getBooleanType() || checker.getTypeAtLocation(node);
                }
                return checker.getTypeAtLocation(node);
            }

            if (ts.isPostfixUnaryExpression(node)) {
                const incrementText = resolveIncrementText(node.operator);
                if (incrementText) {
                    return getEffectiveExpressionType(node.operand) || checker.getTypeAtLocation(node.operand);
                }
            }

            return checker.getTypeAtLocation(node);
        }

        function rewriteBinaryExpression(node) {
            const originalNode = getOriginalNode(node);
            const assignmentOpText = resolveCompoundAssignmentText(node.operatorToken.kind);
            if (assignmentOpText) {
                const left = node.left;
                const right = node.right;
                const leftType = getEffectiveExpressionType(getOriginalNode(originalNode.left)) || checker.getTypeAtLocation(getOriginalNode(originalNode.left));
                const rightType = getEffectiveExpressionType(getOriginalNode(originalNode.right)) || checker.getTypeAtLocation(getOriginalNode(originalNode.right));

                const resolvedAssignment = resolveBinaryAnnotatedMethod(leftType, rightType, assignmentOpText, checker);
                if (resolvedAssignment && resolvedAssignment.side === "left" && resolvedAssignment.arity === 1) {
                    return factory.createAssignment(
                        left,
                        factory.createCallExpression(
                            createResolvedCallTarget(left, resolvedAssignment),
                            undefined,
                            [right]
                        )
                    );
                }

                if (resolvedAssignment && resolvedAssignment.side === "left" && resolvedAssignment.arity === 2) {
                    return factory.createAssignment(
                        left,
                        factory.createCallExpression(
                            createResolvedCallTarget(left, resolvedAssignment),
                            undefined,
                            [left, right]
                        )
                    );
                }

                if (resolvedAssignment && resolvedAssignment.side === "right" && resolvedAssignment.arity === 2) {
                    return factory.createAssignment(
                        left,
                        factory.createCallExpression(
                            createResolvedCallTarget(right, resolvedAssignment),
                            undefined,
                            [left, right]
                        )
                    );
                }
            }

            const operatorText = resolveBinaryOperatorText(originalNode.operatorToken.kind);
            if (!operatorText) {
                return node;
            }

            const left = node.left;
            const right = node.right;
            const leftType = getEffectiveExpressionType(getOriginalNode(originalNode.left)) || checker.getTypeAtLocation(getOriginalNode(originalNode.left));
            const rightType = getEffectiveExpressionType(getOriginalNode(originalNode.right)) || checker.getTypeAtLocation(getOriginalNode(originalNode.right));

            if (isNumberLike(leftType) && isNumberLike(rightType)) {
                return node;
            }

            const resolvedBinary = resolveBinaryAnnotatedMethod(leftType, rightType, operatorText, checker);
            if (resolvedBinary && resolvedBinary.side === "left" && resolvedBinary.arity === 1) {
                return createResolvedBinaryCallExpression(left, right, resolvedBinary);
            }

            if (resolvedBinary && resolvedBinary.side === "left" && resolvedBinary.arity === 2) {
                return createResolvedBinaryCallExpression(left, right, resolvedBinary);
            }

            if (resolvedBinary && resolvedBinary.side === "right" && resolvedBinary.arity === 2) {
                return createResolvedBinaryCallExpression(left, right, resolvedBinary);
            }

            const smartFallback = resolveSmartBinaryFallback(leftType, rightType, operatorText, checker);
            if (smartFallback && smartFallback.kind === "negate-binary") {
                const innerCall = createResolvedBinaryCallExpression(left, right, smartFallback.baseResolved);
                return factory.createPrefixUnaryExpression(
                    ts.SyntaxKind.ExclamationToken,
                    factory.createParenthesizedExpression(innerCall)
                );
            }

            if (smartFallback && smartFallback.kind === "add-with-native-negation") {
                const negatedRight = factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, right);
                return createResolvedBinaryCallExpression(left, negatedRight, smartFallback.addResolved);
            }

            if (smartFallback && smartFallback.kind === "add-with-overload-negation") {
                const negatedRight = createResolvedUnaryCallExpression(right, smartFallback.negResolved);
                return createResolvedBinaryCallExpression(left, negatedRight, smartFallback.addResolved);
            }

            return node;
        }

        function rewritePrefixUnaryExpression(node) {
            const originalNode = getOriginalNode(node);
            const incrementText = resolveIncrementText(originalNode.operator);
            if (incrementText) {
                const operandType = getEffectiveExpressionType(getOriginalNode(originalNode.operand)) || checker.getTypeAtLocation(getOriginalNode(originalNode.operand));
                const resolvedIncrement = resolveIncrementAnnotatedMethod(operandType, incrementText, checker);
                if (resolvedIncrement && resolvedIncrement.arity === 1) {
                    return factory.createAssignment(
                        node.operand,
                        factory.createCallExpression(
                            createResolvedCallTarget(node.operand, resolvedIncrement),
                            undefined,
                            [factory.createNumericLiteral("1")]
                        )
                    );
                }

                if (resolvedIncrement && resolvedIncrement.arity === 2) {
                    return factory.createAssignment(
                        node.operand,
                        factory.createCallExpression(
                            createResolvedCallTarget(node.operand, resolvedIncrement),
                            undefined,
                            [node.operand, factory.createNumericLiteral("1")]
                        )
                    );
                }
            }

            const operatorText = resolveUnaryOperatorText(originalNode.operator);
            if (operatorText) {
                const operandType = getEffectiveExpressionType(getOriginalNode(originalNode.operand)) || checker.getTypeAtLocation(getOriginalNode(originalNode.operand));
                const resolvedUnary = resolveUnaryAnnotatedMethod(operandType, operatorText, checker);
                if (resolvedUnary && resolvedUnary.arity === 0) {
                    return factory.createCallExpression(
                        factory.createPropertyAccessExpression(node.operand, factory.createIdentifier(resolvedUnary.methodName)),
                        undefined,
                        []
                    );
                }
                if (resolvedUnary && resolvedUnary.arity === 1) {
                    return factory.createCallExpression(
                        factory.createPropertyAccessExpression(node.operand, factory.createIdentifier(resolvedUnary.methodName)),
                        undefined,
                        [node.operand]
                    );
                }
            }

            return node;
        }

        function rewritePostfixUnaryExpression(node) {
            const originalNode = getOriginalNode(node);
            const incrementText = resolveIncrementText(originalNode.operator);
            if (incrementText) {
                const operandType = getEffectiveExpressionType(getOriginalNode(originalNode.operand)) || checker.getTypeAtLocation(getOriginalNode(originalNode.operand));
                const resolvedIncrement = resolveIncrementAnnotatedMethod(operandType, incrementText, checker);
                if (resolvedIncrement && resolvedIncrement.arity === 1) {
                    return factory.createAssignment(
                        node.operand,
                        factory.createCallExpression(
                            createResolvedCallTarget(node.operand, resolvedIncrement),
                            undefined,
                            [factory.createNumericLiteral("1")]
                        )
                    );
                }

                if (resolvedIncrement && resolvedIncrement.arity === 2) {
                    return factory.createAssignment(
                        node.operand,
                        factory.createCallExpression(
                            createResolvedCallTarget(node.operand, resolvedIncrement),
                            undefined,
                            [node.operand, factory.createNumericLiteral("1")]
                        )
                    );
                }
            }

            return node;
        }

        function visit(node) {
            const visited = ts.visitEachChild(node, visit, context);
            if (ts.isBinaryExpression(visited)) {
                return rewriteBinaryExpression(visited);
            }
            if (ts.isPrefixUnaryExpression(visited)) {
                return rewritePrefixUnaryExpression(visited);
            }
            if (ts.isPostfixUnaryExpression(visited)) {
                return rewritePostfixUnaryExpression(visited);
            }
            return visited;
        }

        return function transformSourceFile(sourceFile) {
            return ts.visitNode(sourceFile, visit);
        };
    };
}

module.exports = {
    createOperatorOverloadTransformer
};
