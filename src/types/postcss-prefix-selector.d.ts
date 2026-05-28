declare module 'postcss-prefix-selector' {
    import type { Plugin } from 'postcss';
    interface Options {
        prefix: string;
        exclude?: Array<string | RegExp>;
        includeFiles?: Array<string | RegExp>;
        excludeFiles?: Array<string | RegExp>;
        transform?: (prefix: string, selector: string, prefixedSelector: string, filePath?: string, rule?: unknown) => string;
        ignoreFiles?: Array<string | RegExp>;
    }
    const plugin: (options: Options) => Plugin;
    export default plugin;
}
