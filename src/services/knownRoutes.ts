import { SportType } from '../types/domain';

export interface KnownRouteSummary {
  id: number;
  name: string;
  ref?: string;
  network?: string;
  routeType: string;
  center?: [number, number];
}

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

function routeFilterForSport(sport: SportType) {
  if (sport === 'hiking') return '^(hiking|foot)$';
  if (sport === 'mtb') return '^(mtb|bicycle)$';
  return '^bicycle$';
}

async function fetchOverpassJson(query: string): Promise<any> {
  const failures: string[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      // GET est volontaire ici : certains proxys/versions Android renvoient 406
      // sur les POST application/x-www-form-urlencoded vers Overpass.
      const url = `${endpoint}?data=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        return await response.json();
      }

      failures.push(`${response.status}`);
    } catch {
      failures.push('réseau');
    }
  }

  const detail = failures.length ? ` (${failures.join(', ')})` : '';
  throw new Error(`Recherche de parcours momentanément indisponible${detail}.`);
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
  ["route"~"${routePattern}"];
out tags center 80;
`;

  const data = await fetchOverpassJson(query);
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  return elements
    .filter((element: any) => element?.type === 'relation')
    .map((element: any) => {
      const ref = element?.tags?.ref ? String(element.tags.ref) : undefined;
      const rawName = element?.tags?.name ? String(element.tags.name) : undefined;
      const name = rawName || (ref ? `Itinéraire ${ref}` : `Parcours OSM ${element.id}`);

      return {
        id: Number(element.id),
        name,
        ref,
        network: element?.tags?.network ? String(element.tags.network) : undefined,
        routeType: element?.tags?.route ? String(element.tags.route) : 'route',
        center:
          element.center && Number.isFinite(Number(element.center.lon)) && Number.isFinite(Number(element.center.lat))
            ? [Number(element.center.lon), Number(element.center.lat)] as [number, number]
            : undefined,
      } as KnownRouteSummary;
    })
    .filter((route: KnownRouteSummary) => Number.isFinite(route.id))
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

  const data = await fetchOverpassJson(query);
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
