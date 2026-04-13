class Ops {
    constructor(public x: number) {
    }

    // @operator+
    add(y: number): Ops {
        return new Ops(this.x + y)
    }

    // @operator+
    static radd(x: number, y: Ops): Ops {
        return new Ops(x + y.x)
    }

    // @operator-
    sub(y: number): Ops {
        return new Ops(this.x - y)
    }

    // @operator*
    mul(y: number): Ops {
        return new Ops(this.x * y)
    }

    // @operator/
    div(y: number): Ops {
        return new Ops(this.x / y)
    }

    // @operator%
    mod(y: number): Ops {
        return new Ops(this.x % y)
    }

    // @operator**
    pow(y: number): Ops {
        return new Ops(this.x ** y)
    }

    // @operator==
    looseEq(y: number): boolean {
        return this.x == y
    }

    // @operator!=
    looseNeq(y: number): boolean {
        return this.x != y
    }

    // @operator===
    strictEq(y: number): boolean {
        return this.x === y
    }

    // @operator!==
    strictNeq(y: number): boolean {
        return this.x !== y
    }

    // @operator>
    gt(y: number): boolean {
        return this.x > y
    }

    // @operator>=
    gte(y: number): boolean {
        return this.x >= y
    }

    // @operator<
    lt(y: number): boolean {
        return this.x < y
    }

    // @operator&&
    and(y: number): number {
        return this.x && y
    }

    // @operator||
    or(y: number): number {
        return this.x || y
    }

    // @operator??
    nullish(y: number): number {
        return this.x ?? y
    }

    // @operator&
    bitAnd(y: number): number {
        return this.x & y
    }

    // @operator|
    bitOr(y: number): number {
        return this.x | y
    }

    // @operator^
    xor(y: number): number {
        return this.x ^ y
    }

    // @operator<<
    leftShift(y: number): number {
        return this.x << y
    }

    // @operator>>
    rightShift(y: number): number {
        return this.x >> y
    }

    // @operator>>>
    unsignedRightShift(y: number): number {
        return this.x >>> y
    }

    // @operator+
    unaryPlus(): number {
        return +this.x
    }

    // @operator-
    unaryNeg(): number {
        return -this.x
    }

    // @operator!
    unaryNot(): boolean {
        return !this.x
    }

    // @operator~
    unaryBitNot(a: Ops): string {
        return "hello"
    }
}

const base = new Ops(8)
const addRes = base + 2
const raddRes = 2 + base
const subRes = base - 2
const mulRes = base * 2
const divRes = base / 2
const modRes = base % 3
const powRes = base ** 2

const looseEq = base == 8
const looseNeq = base != 3
const strictEq = base === 8
const strictNeq = base !== 3
const gt = base > 3
const gte = base >= 3
const lt = base < 3
const lte = base <= 3

const andRes = base && 1
const orRes = base || 0
const nullishRes = base ?? 0

const bitAnd = base & 1
const bitOr = base | 1
const xorRes = base ^ 1
const leftShift = base << 1
const rightShift = base >> 1
const unsignedRightShift = base >>> 1

const unaryPlus = +base
const unaryNeg = -base
const unaryNot = !base
const unaryBitNot = ~base

let mut = new Ops(5)
mut += 2
mut++
++mut

console.log(
    addRes,
    raddRes,
    subRes,
    mulRes,
    divRes,
    modRes,
    powRes,
    looseEq,
    looseNeq,
    strictEq,
    strictNeq,
    gt,
    gte,
    lt,
    lte,
    andRes,
    orRes,
    nullishRes,
    bitAnd,
    bitOr,
    xorRes,
    leftShift,
    rightShift,
    unsignedRightShift,
    unaryPlus,
    unaryNeg,
    unaryNot,
    unaryBitNot,
    mut
)

