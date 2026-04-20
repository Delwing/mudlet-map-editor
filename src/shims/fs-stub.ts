const notAvailable = (name: string) => () => {
  throw new Error(`fs.${name} is not available in the browser build of mudlet-map-editor`);
};

export default {
  readFileSync: notAvailable('readFileSync'),
  writeFileSync: notAvailable('writeFileSync'),
};

export const readFileSync = notAvailable('readFileSync');
export const writeFileSync = notAvailable('writeFileSync');
