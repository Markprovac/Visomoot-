import { SportType } from '../types/domain';

export interface KnownRouteSummary {
  id: number;
  name: string;
  ref?: string;
  network?: string;
  routeType: string;
  center?: [number, number];
}

// Instances publiques actuellement recommandées / disponibles.
// private.coffee est l'ancien service kumi.systems.
const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.maprva.org/api/interpreter',
];

function routeFilterForSport(sport: SportType) {
  if (sport === 'hiking') return '^(hiking|foot|walking)$';
  if (sport === 'mtb') return '^(mtb|bicycle)$';
  return '^(bicycle|cycling)$';
}

function bboxAround(center: [number, number], radiusM: number) {
  const [longitude, latitude] = center;
  const latDelta = radiusM / 111_320;
  const cosLat = Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const lonDelta = radiusM / (111_320 * cosLat);

  return {
    south: latitude - latDelta,
    west: longitude - lonDelta,
    north: latitude + latDelta,
    east: longitude + lonDelta,
  };
}

async function fetchOverpassJson(query: string): Promise<any> {
  const failures: string[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);

    try {
      // Overpass recommande POST avec le paramètre de formulaire "data".
      // Les GET ?data=... sont actuellement rejetés par certaines instances
      // avec HTTP 406, ce qui expliquait l'échec de la v0.7.1.
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'Visomoot/0.7.2 (personal outdoor application)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      if (response.ok) {
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          failures.push(`${response.status} réponse non JSON`);
          continue;
        }
      }

      failures.push(`${response.status}`);
    } catch (error: any) {
      failures.push(error?.name === 'AbortError' ? 'délai dépassé' : 'réseau');
    } finally {
      clearTimeout(timer);
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
  const routePattern = routeFilterForSport(sport);
  const { south, west, north, east } = bboxAround(center, radiusM);

  // Une bbox est beaucoup moins coûteuse pour Overpass que relation(around:...)
  // sur 25 km et évite les erreurs serveur 500 observées autour de Levens.
  const query = `
[out:json][timeout:25];
relation
  ["type"="route"]
  ["route"~"${routePattern}"]
  (${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)});
out tags center 100;
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
            ? ([Number(element.center.lon), Number(element.center.lat)] as [number, number])
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
