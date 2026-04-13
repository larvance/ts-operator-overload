class Smart {
  constructor(public x: number) {}

  // @operator+
  add(y: number): Smart {
    return new Smart(this.x + y)
  }

  // @operator==
  eq(y: number): boolean {
    return this.x == y
  }

  // @operator<
  lt(y: number): boolean {
    return this.x < y
  }
}

const a = new Smart(8)
const neq = a != 3
const gte = a >= 3
const sub = a - 2

console.log(neq, gte, sub)

