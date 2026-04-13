class EqClass {
    // @operator==
    eq(y: number): string {
        return `${y}`;
    }
}

const a = new EqClass() == 5;
a.split("");

export {};

