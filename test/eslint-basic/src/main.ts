class LintVec {
  constructor(public x: number) {}

  // @operator+
  add(y: number): string {
    return `${this.x + y}`
  }
}

const a = new LintVec(5)
const out = a + 3
console.log(out.split(""))

