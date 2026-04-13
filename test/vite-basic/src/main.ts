class A {
  constructor(public x: number) {}

  // @operator+
  add(y: number): string {
    return `Adding ${y} to ${this.x}`;
  }
}

const c = new A(5);
const d = c + 5;
console.log(d);
