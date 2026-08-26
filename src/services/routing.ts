import { SportType } from '../types/domain';

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const CLIENT_ID = 'visomoot-personal-app';

export interface RoutedPath {
  coordinates: Array<[number, number]>;
  distanceM: number;
  durationS: number;
}

function decodePolyline6(encoded: string): Array<[number, number]> {
  let index = 0;
  let lat = 0;
  let lon = 0;
  const coordinates: Array<[number, number]> = [];
  const factor = 1e6;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    lon += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}

function routingProfile(sport: SportType) {
  if (sport === 'hiking') {
    return {
      costing: 'pedestrian',
      costing_options: {
        pedestrian: {
          walking_speed: 5,
          use_hills: 0.55,
          use_ferry: 0.2,
        },
      },
    };
  }

  const bicycleType = sport === 'road_bike' ? 'road' : sport === 'gravel' ? 'cross' : 'mountain';
  const useRoads = sport === 'road_bike' ? 0.85 : sport === 'gravel' ? 0.35 : 0.1;
  const useHills = sport === 'road_bike' ? 0.35 : sport === 'gravel' ? 0.5 : 0.6;

  return {
    costing: 'bicycle',
    costing_options: {
      bicycle: {
        bicycle_type: bicycleType,
        use_roads: useRoads,
        use_hills: useHills,
        use_ferry: 0.2,
      },
    },
  };
}

export async function routeViaWaypoints(
  waypoints: Array<[number, number]>,
  sport: SportType,
): Promise<RoutedPath> {
  if (waypoints.length < 2) {
    return { coordinates: waypoints, distanceM: 0, durationS: 0 };
  }

  const profile = routingProfile(sport);
  const body = {
    locations: waypoints.map(([lon, lat]) => ({ lat, lon, type: 'break' })),
    ...profile,
    directions_options: {
      units: 'kilometers',
      language: 'fr-FR',
    },
  };

  const response = await fetch(VALHALLA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': CLIENT_ID,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      detail = text ? ` (${text.slice(0, 160)})` : '';
    } catch {
      // rien
    }
    throw new Error(`Le calcul d’itinéraire a échoué${detail}`);
  }

  const json: any = await response.json();
  const legs: any[] = json?.trip?.legs ?? [];
  if (!legs.length) throw new Error('Aucun chemin praticable trouvé entre ces points.');

  const coordinates: Array<[number, number]> = [];
  for (const leg of legs) {
    if (!leg?.shape) continue;
    const decoded = decodePolyline6(String(leg.shape));
    if (!decoded.length) continue;
    if (coordinates.length && decoded.length) decoded.shift();
    coordinates.push(...decoded);
  }

  if (coordinates.length < 2) throw new Error('Le service de routage n’a pas renvoyé de tracé exploitable.');

  const lengthKm = Number(json?.trip?.summary?.length ?? 0);
  const timeS = Number(json?.trip?.summary?.time ?? 0);

  return {
    coordinates,
    distanceM: Number.isFinite(lengthKm) ? lengthKm * 1000 : 0,
    durationS: Number.isFinite(timeS) ? timeS : 0,
  };
}
