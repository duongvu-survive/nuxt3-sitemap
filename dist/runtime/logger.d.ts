export declare function warn(message: any, options?: null): void;
export declare function fatal(message: any, options?: null): void;
declare const _default: {
    success: (message: any, ...args: any[]) => void;
    info: (message: any, ...args: any[]) => void;
    fatal: typeof fatal;
    warn: typeof warn;
};
export default _default;
