declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson';

  function shp(
    base: string | ArrayBuffer | Buffer,
  ): Promise<FeatureCollection | FeatureCollection[]>;

  export default shp;
}
