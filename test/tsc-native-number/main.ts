class A {
    constructor(public x: number) {
    }

      // @operator+
      add(y: number): number {
        return this.x + y;
    }
}

const a = 10;
const b = 20;
const c = a + b;
console.log(c);
