const EARTH_RADIUS_M = 6371000;
const toRad = (v: number) => (v * Math.PI) / 180;

export function routeDistanceM(coords: Array<[number, number]>) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    total += 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
  }
  return total;
}
