/// <reference types="vite/client" />

declare module 'mudlet-map-binary-reader/dist/models/mudlet-models' {
  export const QUserType: {
    read(buf: unknown, name: string): any;
    get(name: string): { from(value: any): { toBuffer(arg?: boolean): Buffer } };
  };
  export const MudletTypeIds: { LABELS: 200; ROOMS: 201; AREAS: 202 };
}

declare module 'qtdatastream/src/buffer' {
  export class ReadBuffer {
    constructor(buffer: Buffer);
  }
}

// monaco-editor's package.json only declares types for the top-level entry.
// We import the trimmed `edcore.main` at runtime but reuse the same public
// type surface via the re-export below.
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor';
}
declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
