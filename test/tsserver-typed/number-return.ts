class MyClass {
    // @operator*
    mul(y: number): number {
        return y;
    }
}

const a = new MyClass() * 5;
a.split("");

export {};

