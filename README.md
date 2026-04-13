# ts-operator-overload

Typed operator overloading for TypeScript using `// @operator...` annotations

Write normal operators in your code (`a + b`, `~x`, `x += y`) and let the transformer/plugin rewrite them to method
calls with type-aware resolution

## Table of Contents

- [What This Is](#what-this-is)
- [Quick Start (2 Minutes)](#quick-start-2-minutes)
- [How It Chooses Which Method to Call](#how-it-chooses-which-method-to-call)
- [Supported Operators](#supported-operators)
- [Valid Annotation Signatures](#valid-annotation-signatures)
- [TSConfig / tsserver Plugin](#tsconfig--tsserver-plugin)
- [Programmatic API](#programmatic-api)
- [Diagnostics and Custom Errors](#diagnostics-and-custom-errors)
- [Examples](#examples)
- [IDE Quick Setup (VS Code and JetBrains)](#ide-quick-setup-vs-code-and-jetbrains)
- [Troubleshooting](#troubleshooting)
- [Development and Tests](#development-and-tests)

## What This Is

`ts-operator-overload` lets you define operator behavior on your own types with method annotations

Example:

```ts
class Vec {
    constructor(public x: number) {
    }

    // @operator+
    add(y: number): Vec {
        return new Vec(this.x + y)
    }
}

const v = new Vec(1)
const r = v + 2 // rewritten to v.add(2)
```

This package supports:

- compile-time rewriting for `tsc` transformer usage
- editor-time diagnostics and type feedback through a `tsserver` plugin

## Quick Start (2 Minutes)

### 1) Install

```bash
npm install ts-operator-overload
```

### 2) Annotate methods

```ts
class A {
    constructor(public x: number) {
    }

    // @operator+
    add(y: number): string {
        return `Adding ${y} to ${this.x}`
    }
}

const c = new A(5)
const d = c + 5 // becomes c.add(5)
```

### 3) Enable plugin in `tsconfig.json` for editor behavior

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-operator-overload",
        "mode": "shadow"
      }
    ]
  }
}
```

## How It Chooses Which Method to Call

For a binary expression like:

```ts
A + B
```

the resolver checks in this order and picks the first match:

1. `A.add(B)`
2. `A.add(A, B)` as a static method
3. `B.add(A, B)` as a static method

So left-operand methods are preferred before reverse/right-side fallback

For unary operators, the resolver checks:

1. zero-arg form, for example `x.unaryBitNot()`
2. one-arg self form, for example `x.unaryBitNot(x)`

For compound assignment and increments:

- `x += y` resolves as assignment using `@operator+`
- `x++` and `++x` resolve as assignment using `@operator+` with `1`
- similarly `-=` and `--` resolve via `@operator-`

Smart fallbacks are included for missing operators:

- if `a != b` is missing but `a == b` exists, it rewrites to `!(a == b)`
- for comparisons, it prefers single-op negation fallbacks like `a >= b` -> `!(a < b)`
- if `a - b` is missing but `a + ...` exists, it rewrites as `a + (-b)` (using native or overloaded unary `-`)

## Supported Operators

### Binary operators

- `@operator+`
- `@operator-`
- `@operator*`
- `@operator/`
- `@operator%`
- `@operator**`
- `@operator==`
- `@operator!=`
- `@operator===`
- `@operator!==`
- `@operator>`
- `@operator>=`
- `@operator<`
- `@operator<=`
- `@operator&&`
- `@operator||`
- `@operator??`
- `@operator&`
- `@operator|`
- `@operator^`
- `@operator<<`
- `@operator>>`
- `@operator>>>`

### Unary operators

- `@operator+`
- `@operator-`
- `@operator!`
- `@operator~`

### Compound and increment forms

Mapped through annotated binary operators:

- `+=`, `-=`, `*=`, `/=`, `%=`, `**=`
- `&&=`, `||=`, `??=`
- `&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=`
- `++`, `--`

## Valid Annotation Signatures

The annotation validator enforces accepted method shapes

### Binary form (`@operator+`, etc)

Accepted:

```ts
// one-arg left form
add(b: number): Result

// two-arg left form (must be static)
static add(a: ThisType, b: number): Result

// two-arg right/reverse form (on rhs type, must be static)
static add(a: number, b: ThisType): Result
```

### Unary form (`@operator!`, `@operator~`, unary `+` and `-`)

Accepted:

```ts
unaryNot(): Result
unaryNot(a: ThisType): Result
```

Rejected example (custom error):

```ts
// @operator~
unaryBitNot(a: Ops, b: number): string // invalid
```

## TSConfig / tsserver Plugin

Set in `compilerOptions.plugins`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-operator-overload",
        "mode": "shadow"
      }
    ]
  }
}
```

Modes:

- `suppress` suppresses operator diagnostics when a valid overload exists
- `shadow` builds a rewritten virtual program for richer types, completions, and inlay hints
- `hybrid` responds fast like `suppress`, then warms shadow typing after edits settle

Performance options for `shadow` mode:

- `shadowScope`: `"file"` (default, rewrites only requested file) or `"project"`
- `maxShadowFiles`: auto-fallback threshold for large projects (0 disables threshold)
- `autoFallbackToSuppress`: `true` by default
- `shadowFeatures`: selectively enable expensive editor features

Hybrid options:

- `hybridDebounceMs`: wait time after edits before warm shadow rebuild (default `800`)
- `hybridWarmOn`: per-feature shadow enablement in hybrid mode
- `hybridMaxBuildMs`: optional budget for a warm rebuild before it is treated as failed
- `hybridFailureDisableAfter`: disable hybrid warmup temporarily after repeated failures
- `hybridCooldownMs`: cooldown duration before retrying warmups

Example hybrid config:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-operator-overload",
        "mode": "hybrid",
        "shadowScope": "file",
        "maxShadowFiles": 400,
        "hybridDebounceMs": 800,
        "hybridWarmOn": {
          "quickInfo": true,
          "completions": true,
          "completionDetails": true,
          "inlayHints": false,
          "diagnostics": false
        }
      }
    ]
  }
}
```

Large-project recommended config (fast editor feedback):

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-operator-overload",
        "mode": "shadow",
        "shadowScope": "file",
        "maxShadowFiles": 400,
        "autoFallbackToSuppress": true,
        "shadowFeatures": {
          "diagnostics": true,
          "quickInfo": true,
          "completions": false,
          "completionDetails": false,
          "inlayHints": false
        }
      }
    ]
  }
}
```

If you only want fast error suppression and don't need shadow-typed editor features, use `"mode": "suppress"`.

## Programmatic API

From `index.d.ts`:

- `createOperatorOverloadTransformer(program, options?)`
- `createTscTransformer(program, options?)`
- `shouldSuppressOperatorDiagnostic(diagnostic, program, options?)`
- `tsserverPlugin`

Current option field:

- `allowRightOperand?: boolean`

## Diagnostics and Custom Errors

Standard TS operator diagnostics may appear when no valid overload is found, such as:

- `TS2362`
- `TS2363`
- `TS2365`
- `TS2367`

This package also emits custom annotation validation diagnostics:

- `TS93001` (source: `ts-operator-overload`)

Typical causes:

- unsupported `@operator...` token
- invalid arity for unary/binary operator
- invalid two-arg form that does not include the owning type

## Examples

### Reverse add fallback

```ts
class A {
    constructor(public x: number) {
    }
}

class B {
    constructor(public y: number) {
    }

    // @operator+
    add(a: A, b: B): string {
        return `${a.x}+${b.y}`
    }
}

const a = new A(1)
const b = new B(2)
const out = a + b // falls back to b.add(a, b)
```

### Equality overload

```ts
class EqClass {
    // @operator==
    eq(y: number): string {
        return `${y}`
    }
}

const r = new EqClass() == 5 // rewritten to .eq(5), type string
r.split("")
```

## IDE Quick Setup (VS Code and JetBrains)

Use each project's local TypeScript version so the plugin behavior matches the project dependencies.

### VS Code (fast path)

1. Open the target project folder (example: `test/vscode-basic`)
2. Install dependencies in that folder
3. Point VS Code to local TypeScript at `node_modules/typescript/lib`
4. Run `TypeScript: Select TypeScript Version` and choose `Use Workspace Version`

Example commands:

```bash
npm --prefix test/vscode-basic install
```

If needed, set this in `.vscode/settings.json` inside that project:

```json
{
  "typescript.tsdk": "./node_modules/typescript/lib"
}
```

### JetBrains IDEs (WebStorm / IntelliJ)

1. Open the target project folder in the IDE
2. Install dependencies in that folder
3. Go to `Settings > Languages & Frameworks > TypeScript`
4. Enable TypeScript service
5. Set `TypeScript package` to the local path: `<project>/node_modules/typescript`

Example command:

```bash
npm --prefix test/nextjs-basic install
```

This ensures editor diagnostics and types use the project's own TypeScript instead of a global version.

## Troubleshooting

- operator not rewritten: check method annotation and signature shape
- type still looks native in editor: ensure plugin is loaded and mode is `shadow`
- unexpected custom error `TS93001`: method has an invalid operator signature
- right-side fallback not used: left matches always win and number-like rhs fallback is restricted

## Development and Tests

Run full matrix:

```bash
npm install
npm test
```

Included test areas:

- `test/tsc-*` transformer output and expected-error cases
- `test/tsserver-smoke` diagnostic suppression behavior
- `test/tsserver-typed` quick-info, inlay, and completion type propagation
- `test/eslint-basic` eslint integration and TypeScript parsing/linting compatibility
- `test/vite-basic` and `test/nextjs-basic` integration builds

