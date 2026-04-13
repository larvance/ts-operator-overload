export class A {
    constructor(public x: number) {
    }

      // @operator+
      add(y: number): string {
        return `Adding ${y} to ${this.x}`;
    }
}

