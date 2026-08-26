import { SportType } from '../types/domain';

export interface KnownRouteSummary {
  id: number;
  name: string;
  ref?: string;
  network?: string;
  routeType: string;
  center?: [number, number];
}

function routeFilterForSport(sport: SportType) {
  if (sport === 'hiking') return '^(hiking|foot)$';
  if (sport === 'mtb') return '^(mtb|bicycle)$';
  return '^bicycle$';
}

export async function findKnownRoutes(
  center: [number, number],
  sport: SportType,
  radiusM = 25000,
): Promise<KnownRouteSummary[]> {
  const [longitude, latitude] = center;
  const routePattern = routeFilterForSport(sport);
  const query = `
[out:json][timeout:25];
relation(around:${Math.round(radiusM)},${latitude},${longitude})
  ["type"="route"]
  ["route"~"${routePattern}"]
  ["name"];
out tags center 40;
`;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Recherche de parcours indisponible (${response.status}).`);
  }

  const data = await response.json();
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  return elements
    .filter((element: any) => element?.type === 'relation' && element?.tags?.name)
    .map((element: any) => ({
      id: Number(element.id),
      name: String(element.tags.name),
      ref: element.tags.ref ? String(element.tags.ref) : undefined,
      network: element.tags.network ? String(element.tags.network) : undefined,
      routeType: element.tags.route ? String(element.tags.route) : 'route',
      center:
        element.center && Number.isFinite(Number(element.center.lon)) && Number.isFinite(Number(element.center.lat))
          ? [Number(element.center.lon), Number(element.center.lat)] as [number, number]
          : undefined,
    }))
    .sort((a: KnownRouteSummary, b: KnownRouteSummary) => {
      const aRef = a.ref ? 0 : 1;
      const bRef = b.ref ? 0 : 1;
      return aRef - bRef || a.name.localeCompare(b.name, 'fr');
    });
}

function sameCoordinate(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

function appendSegment(target: Array<[number, number]>, segment: Array<[number, number]>) {
  if (!segment.length) return;
  if (!target.length) {
    target.push(...segment);
    return;
  }

  const last = target[target.length - 1];
  const first = segment[0];
  const end = segment[segment.length - 1];

  if (sameCoordinate(last, first)) {
    target.push(...segment.slice(1));
  } else if (sameCoordinate(last, end)) {
    target.push(...segment.slice(0, -1).reverse());
  } else {
    target.push(...segment);
  }
}

export async function loadKnownRouteGeometry(relationId: number): Promise<Array<[number, number]>> {
  const query = `
[out:json][timeout:30];
rel(${relationId});
out body geom;
`;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Impossible de charger le parcours (${response.status}).`);
  }

  const data = await response.json();
  const relation = Array.isArray(data?.elements)
    ? data.elements.find((element: any) => element?.type === 'relation' && Number(element.id) === relationId)
    : null;

  const coordinates: Array<[number, number]> = [];
  const members = Array.isArray(relation?.members) ? relation.members : [];

  for (const member of members) {
    if (member?.type !== 'way' || !Array.isArray(member?.geometry)) continue;
    const segment = member.geometry
      .map((point: any) => [Number(point?.lon), Number(point?.lat)] as [number, number])
      .filter(([lon, lat]: [number, number]) => Number.isFinite(lon) && Number.isFinite(lat));
    appendSegment(coordinates, segment);
  }

  if (coordinates.length < 2) {
    throw new Error('Ce parcours OSM ne fournit pas de géométrie exploitable pour le moment.');
  }

  return coordinates;
}
