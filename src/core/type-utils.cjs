const ts = require("typescript");

function isNumberLike(type) {
    return (type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.NumberLiteral | ts.TypeFlags.EnumLike)) !== 0;
}

function parseOperatorComment(declaration) {
    if (!declaration) {
        return null;
    }
    const sourceFile = declaration.getSourceFile && declaration.getSourceFile();
    if (!sourceFile) {
        return null;
    }
    const sourceText = sourceFile.getFullText();
    const ranges = ts.getLeadingCommentRanges(sourceText, declaration.getFullStart()) || [];
    for (const range of ranges) {
        const text = sourceText.slice(range.pos, range.end);
        const match = text.match(/@operator\s*([+\-*/%<>=!&|^~?]{1,3})/);
        if (!match) {
            continue;
        }
        return {operator: match[1]};
    }
    return null;
}

function getDeclarationNameText(declaration, fallbackName) {
    const name = declaration && declaration.name;
    if (name && ts.isIdentifier(name)) {
        return name.text;
    }
    if (name && ts.isStringLiteral(name)) {
        return name.text;
    }
    return fallbackName || null;
}

function getDeclarationParameterTypes(declaration, checker) {
    const signature = checker.getSignatureFromDeclaration(declaration);
    if (!signature) {
        return null;
    }
    const parameters = signature.getParameters();
    return parameters.map((parameter) => checker.getTypeOfSymbolAtLocation(parameter, declaration));
}

function getDeclarationReturnType(declaration, checker) {
    const signature = checker.getSignatureFromDeclaration(declaration);
    if (!signature) {
        return null;
    }
    return checker.getReturnTypeOfSignature(signature);
}

function areArgumentsAssignable(argumentTypes, parameterTypes, checker) {
    if (!Array.isArray(argumentTypes) || !Array.isArray(parameterTypes) || argumentTypes.length !== parameterTypes.length) {
        return false;
    }
    for (let index = 0; index < argumentTypes.length; index += 1) {
        if (!checker.isTypeAssignableTo(argumentTypes[index], parameterTypes[index])) {
            return false;
        }
    }
    return true;
}

function hasModifier(declaration, modifierKind) {
    if (!declaration || !Array.isArray(declaration.modifiers)) {
        return false;
    }
    return declaration.modifiers.some((modifier) => modifier.kind === modifierKind);
}

function declarationMatchesOperator(declaration, operatorText, arity) {
    if (!declaration || (!ts.isMethodDeclaration(declaration) && !ts.isMethodSignature(declaration))) {
        return false;
    }
    if (typeof arity === "number" && Array.isArray(declaration.parameters) && declaration.parameters.length !== arity) {
        return false;
    }

    const info = parseOperatorComment(declaration);
    return !!(info && info.operator === operatorText);
}

function findAnnotatedOperatorMethodByArguments(type, operatorText, checker, argumentTypes, seen) {
    if (!type || !operatorText) {
        return null;
    }

    const seenSet = seen || new Set();
    if (seenSet.has(type)) {
        return null;
    }
    seenSet.add(type);

    if (type.isUnionOrIntersection && type.isUnionOrIntersection()) {
        for (const part of type.types) {
            const match = findAnnotatedOperatorMethodByArguments(part, operatorText, checker, argumentTypes, seenSet);
            if (match) {
                return match;
            }
        }
    }

    const candidates = [type];
    const apparentType = checker.getApparentType(type);
    if (apparentType && apparentType !== type) {
        candidates.push(apparentType);
    }

    for (const candidateType of candidates) {
        for (const property of checker.getPropertiesOfType(candidateType)) {
            if (!Array.isArray(property.declarations)) {
                continue;
            }

            for (const declaration of property.declarations) {
                if (!declarationMatchesOperator(declaration, operatorText, argumentTypes.length)) {
                    continue;
                }

                const parameterTypes = getDeclarationParameterTypes(declaration, checker);
                if (!areArgumentsAssignable(argumentTypes, parameterTypes, checker)) {
                    continue;
                }

                const methodName = getDeclarationNameText(declaration, typeof property.getName === "function" ? property.getName() : null);
                if (methodName) {
                    return {
                        methodName,
                        returnType: getDeclarationReturnType(declaration, checker)
                    };
                }
            }
        }
    }

    return null;
}

function findAnnotatedStaticOperatorMethodByArguments(type, operatorText, checker, argumentTypes, seen) {
    if (!type || !operatorText) {
        return null;
    }

    const seenSet = seen || new Set();
    if (seenSet.has(type)) {
        return null;
    }
    seenSet.add(type);

    if (type.isUnionOrIntersection && type.isUnionOrIntersection()) {
        for (const part of type.types) {
            const match = findAnnotatedStaticOperatorMethodByArguments(part, operatorText, checker, argumentTypes, seenSet);
            if (match) {
                return match;
            }
        }
    }

    const candidates = [type];
    const apparentType = checker.getApparentType(type);
    if (apparentType && apparentType !== type) {
        candidates.push(apparentType);
    }

    for (const candidateType of candidates) {
        const symbol = candidateType.getSymbol && candidateType.getSymbol();
        if (!symbol || !Array.isArray(symbol.declarations)) {
            continue;
        }

        for (const declaration of symbol.declarations) {
            if (!declaration || !declaration.members || !declaration.name || !ts.isIdentifier(declaration.name)) {
                continue;
            }
            const ownerName = declaration.name.text;

            for (const member of declaration.members) {
                if (!ts.isMethodDeclaration(member) || !hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
                    continue;
                }
                if (!declarationMatchesOperator(member, operatorText, argumentTypes.length)) {
                    continue;
                }

                const parameterTypes = getDeclarationParameterTypes(member, checker);
                if (!areArgumentsAssignable(argumentTypes, parameterTypes, checker)) {
                    continue;
                }

                const methodName = getDeclarationNameText(member, null);
                if (methodName) {
                    return {
                        ownerName,
                        methodName,
                        returnType: getDeclarationReturnType(member, checker)
                    };
                }
            }
        }
    }

    return null;
}

function getAnnotatedMethodNameFromSymbol(symbol, operatorText, arity) {
    if (!symbol || !Array.isArray(symbol.declarations)) {
        return null;
    }
    for (const declaration of symbol.declarations) {
        if (!declarationMatchesOperator(declaration, operatorText, arity)) {
            continue;
        }
        const name = declaration.name;
        if (name && ts.isIdentifier(name)) {
            return name.text;
        }
        if (name && ts.isStringLiteral(name)) {
            return name.text;
        }
        if (typeof symbol.getName === "function") {
            return symbol.getName();
        }
    }
    return null;
}

function findAnnotatedOperatorMethodName(type, operatorText, checker, arity, seen) {
    if (!type || !operatorText) {
        return null;
    }

    const seenSet = seen || new Set();
    if (seenSet.has(type)) {
        return null;
    }
    seenSet.add(type);

    if (type.isUnionOrIntersection && type.isUnionOrIntersection()) {
        for (const part of type.types) {
            const match = findAnnotatedOperatorMethodName(part, operatorText, checker, arity, seenSet);
            if (match) {
                return match;
            }
        }
    }

    for (const property of checker.getPropertiesOfType(type)) {
        const match = getAnnotatedMethodNameFromSymbol(property, operatorText, arity);
        if (match) {
            return match;
        }
    }

    const apparentType = checker.getApparentType(type);
    if (apparentType && apparentType !== type) {
        for (const property of checker.getPropertiesOfType(apparentType)) {
            const match = getAnnotatedMethodNameFromSymbol(property, operatorText, arity);
            if (match) {
                return match;
            }
        }
    }

    return null;
}

function resolveBinaryAnnotatedMethod(leftType, rightType, operatorText, checker) {
    const leftOneArg = findAnnotatedOperatorMethodByArguments(leftType, operatorText, checker, [rightType]);
    if (leftOneArg) {
        return {
            side: "left",
            methodName: leftOneArg.methodName,
            arity: 1,
            invokeKind: "instance",
            returnType: leftOneArg.returnType || null
        };
    }

    const leftTwoArg = findAnnotatedStaticOperatorMethodByArguments(leftType, operatorText, checker, [leftType, rightType]);
    if (leftTwoArg) {
        return {
            side: "left",
            methodName: leftTwoArg.methodName,
            arity: 2,
            invokeKind: "static",
            ownerName: leftTwoArg.ownerName,
            returnType: leftTwoArg.returnType || null
        };
    }

    const rightTwoArg = !isNumberLike(rightType)
        ? findAnnotatedStaticOperatorMethodByArguments(rightType, operatorText, checker, [leftType, rightType])
        : null;
    if (rightTwoArg) {
        return {
            side: "right",
            methodName: rightTwoArg.methodName,
            arity: 2,
            invokeKind: "static",
            ownerName: rightTwoArg.ownerName,
            returnType: rightTwoArg.returnType || null
        };
    }

    return null;
}

function resolveIncrementAnnotatedMethod(type, operatorText, checker) {
    const numberType = checker.getNumberType ? checker.getNumberType() : null;
    const oneArg = numberType
        ? findAnnotatedOperatorMethodByArguments(type, operatorText, checker, [numberType])
        : findAnnotatedOperatorMethodName(type, operatorText, checker, 1);
    if (oneArg) {
        if (typeof oneArg === "string") {
            return {methodName: oneArg, arity: 1, invokeKind: "instance"};
        }
        return {
            methodName: oneArg.methodName,
            arity: 1,
            invokeKind: "instance",
            returnType: oneArg.returnType || null
        };
    }

    const twoArg = numberType
        ? findAnnotatedStaticOperatorMethodByArguments(type, operatorText, checker, [type, numberType])
        : findAnnotatedOperatorMethodName(type, operatorText, checker, 2);
    if (twoArg) {
        if (typeof twoArg === "string") {
            return {methodName: twoArg, arity: 2, invokeKind: "instance"};
        }
        return {
            methodName: twoArg.methodName,
            arity: 2,
            invokeKind: "static",
            ownerName: twoArg.ownerName,
            returnType: twoArg.returnType || null
        };
    }

    return null;
}

function resolveUnaryAnnotatedMethod(type, operatorText, checker) {
    const zeroArg = findAnnotatedOperatorMethodByArguments(type, operatorText, checker, []);
    if (zeroArg) {
        return {methodName: zeroArg.methodName, arity: 0, returnType: zeroArg.returnType || null};
    }

    const oneArg = findAnnotatedOperatorMethodByArguments(type, operatorText, checker, [type]);
    if (oneArg) {
        return {methodName: oneArg.methodName, arity: 1, returnType: oneArg.returnType || null};
    }

    return null;
}

function resolveSmartBinaryFallback(leftType, rightType, operatorText, checker) {
    const negateFromMap = {
        "!=": "==",
        "!==": "===",
        ">=": "<",
        ">": "<=",
        "<=": ">",
        "<": ">="
    };

    const negateSource = negateFromMap[operatorText];
    if (negateSource) {
        const baseResolved = resolveBinaryAnnotatedMethod(leftType, rightType, negateSource, checker);
        if (baseResolved) {
            return {
                kind: "negate-binary",
                sourceOperator: negateSource,
                baseResolved
            };
        }
    }

    if (operatorText === "-") {
        const addResolved = resolveBinaryAnnotatedMethod(leftType, rightType, "+", checker);
        if (!addResolved) {
            return null;
        }

        if (isNumberLike(rightType)) {
            return {
                kind: "add-with-native-negation",
                addResolved
            };
        }

        const negResolved = resolveUnaryAnnotatedMethod(rightType, "-", checker);
        if (negResolved) {
            return {
                kind: "add-with-overload-negation",
                addResolved,
                negResolved
            };
        }
    }

    return null;
}

module.exports = {
    isNumberLike,
    findAnnotatedOperatorMethodName,
    resolveBinaryAnnotatedMethod,
    resolveIncrementAnnotatedMethod,
    resolveUnaryAnnotatedMethod,
    resolveSmartBinaryFallback
};
