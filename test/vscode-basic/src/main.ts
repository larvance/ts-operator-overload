class V {
    constructor(public x: number) {}

    // @operator+
    add(y: number): string {
        return `sum(${this.x}, ${y})`;
    }
}

const c = new V(5);
const d = c + 2;
d.split("");

