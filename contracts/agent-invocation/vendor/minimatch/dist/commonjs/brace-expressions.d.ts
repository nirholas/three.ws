export type ParseClassResult = [
    src: string,
    uFlag: boolean,
    consumed: number,
    hasMagic: boolean
];
export declare const parseClass: (glob: string, position: number) => ParseClassResult;
