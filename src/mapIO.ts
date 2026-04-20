import { Buffer } from 'buffer';
import {
  readMapFromBuffer,
  writeMapToBuffer,
  readerExport,
  type MudletMap,
  type MudletRoom,
  type MudletColor,
} from 'mudlet-map-binary-reader';

export type { MudletMap, MudletRoom, MudletColor };

export function readMapFromBytes(bytes: ArrayBuffer): MudletMap {
  return readMapFromBuffer(Buffer.from(bytes));
}

export function writeMapToBytes(map: MudletMap): Uint8Array {
  return new Uint8Array(writeMapToBuffer(map));
}

export function buildRendererInput(map: MudletMap) {
  return readerExport(map);
}

export function createEmptyMap(): MudletMap {
  return {
    version: 20,
    rooms: {},
    areas: {
      [-1]: {
        rooms: [],
        zLevels: [0],
        mAreaExits: {},
        gridMode: false,
        max_x: 0, max_y: 0, max_z: 0,
        min_x: 0, min_y: 0, min_z: 0,
        span: [0, 0, 0],
        xmaxForZ: {}, ymaxForZ: {}, xminForZ: {}, yminForZ: {},
        pos: [0, 0, 0],
        isZone: false,
        zoneAreaRef: -1,
        userData: {},
      },
    },
    areaNames: { [-1]: 'Default Area' },
    mCustomEnvColors: {},
    envColors: {},
    mpRoomDbHashToRoomId: {},
    mRoomIdHash: {},
    mUserData: {},
    labels: {},
    mapSymbolFont: { family: '', style: '' } as any,
    mapFontFudgeFactor: 1,
    useOnlyMapFont: false,
  };
}
