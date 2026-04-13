class Ops {
    constructor(public x: number) {}

    // @operator~
    unaryBitNot(a: Ops, b: number): string {
        return `${a.x + b}`;
    }
}

const base = new Ops(8);
const bad = ~base;
console.log(bad);

