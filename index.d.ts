import ts = require("typescript");

export function createOperatorOverloadTransformer(
    program: ts.Program,
    options?: {
        allowRightOperand?: boolean;
    }
): ts.TransformerFactory<ts.SourceFile>;

export function createTscTransformer(
    program: ts.Program,
    options?: {
        allowRightOperand?: boolean;
    }
): ts.TransformerFactory<ts.SourceFile>;

export function shouldSuppressOperatorDiagnostic(
    diagnostic: ts.Diagnostic,
    program: ts.Program,
    options?: {
        allowRightOperand?: boolean;
    }
): boolean;

export const tsserverPlugin: (modules: { typescript: typeof ts }) => {
    create: (info: any) => any;
};
