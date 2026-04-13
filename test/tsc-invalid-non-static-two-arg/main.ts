class Bad {
  constructor(public x: number) {}

  // @operator+
  add(a: Bad, b: number): string {
    return `${a.x + b}`
  }
}

const v = new Bad(1)
const r = v + 2
console.log(r)

