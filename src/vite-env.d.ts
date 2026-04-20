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
