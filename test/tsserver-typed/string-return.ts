class MyClass {
    // @operator*
    mul(y: number): string {
        return `${y}`;
    }
}

const a = new MyClass() * 5;
a.split("");

export {};

