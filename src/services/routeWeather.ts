import { SportType } from '../types/domain';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export interface RouteWeatherAlert {
  distanceAheadM: number;
  etaMinutes: number;
  rainMm15: number;
  precipitationMm15: number;
  weatherCode: number | null;
  coordinate: [number, number];
}

export interface RouteWeatherResult {
  status: 'rain' | 'dry' | 'unavailable';
  summary: string;
  alert: RouteWeatherAlert | null;
  checkedAt: number;
}

const R = 6371000;
const rad = (value: number) => (value * Math.PI) / 180;

function distanceM(a: [number, number], b: [number, number]) {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const la1 = rad(lat1);
  const la2 = rad(lat2);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cumulativeDistances(route: Array<[number, number]>) {
  const cumulative = [0];
  for (let i = 1; i < route.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceM(route[i - 1], route[i]));
  }
  return cumulative;
}

function nearestRouteIndex(route: Array<[number, number]>, current: [number, number] | null) {
  if (!current || !route.length) return 0;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < route.length; i++) {
    const d = distanceM(route[i], current);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function pointAtDistance(
  route: Array<[number, number]>,
  cumulative: number[],
  targetDistance: number,
): [number, number] {
  if (targetDistance <= 0) return route[0];
  const last = cumulative[cumulative.length - 1] ?? 0;
  if (targetDistance >= last) return route[route.length - 1];

  let i = 1;
  while (i < cumulative.length && cumulative[i] < targetDistance) i++;
  const before = Math.max(0, i - 1);
  const segmentLength = cumulative[i] - cumulative[before];
  const ratio = segmentLength > 0 ? (targetDistance - cumulative[before]) / segmentLength : 0;
  const [lon1, lat1] = route[before];
  const [lon2, lat2] = route[i];
  return [lon1 + (lon2 - lon1) * ratio, lat1 + (lat2 - lat1) * ratio];
}

export function defaultSportSpeedKmh(sport: SportType) {
  if (sport === 'hiking') return 4.5;
  if (sport === 'road_bike') return 22;
  if (sport === 'gravel') return 17;
  return 13;
}

function nearestTimeIndex(times: number[], targetSeconds: number) {
  if (!times.length) return -1;
  let best = 0;
  let diff = Math.abs(times[0] - targetSeconds);
  for (let i = 1; i < times.length; i++) {
    const d = Math.abs(times[i] - targetSeconds);
    if (d < diff) {
      diff = d;
      best = i;
    }
  }
  return best;
}

function rainDescription(amount: number) {
  if (amount >= 2) return 'forte pluie';
  if (amount >= 0.6) return 'pluie';
  return 'faible pluie';
}

export async function forecastRainAhead(
  route: Array<[number, number]>,
  sport: SportType,
  currentCoordinate: [number, number] | null = null,
  observedSpeedKmh?: number | null,
): Promise<RouteWeatherResult> {
  if (route.length < 2) {
    return {
      status: 'unavailable',
      summary: 'Prévision parcours disponible dès qu’un itinéraire est calculé.',
      alert: null,
      checkedAt: Date.now(),
    };
  }

  const speedKmh =
    observedSpeedKmh && observedSpeedKmh >= 2 && observedSpeedKmh <= 80
      ? observedSpeedKmh
      : defaultSportSpeedKmh(sport);
  const speedMPerMin = (speedKmh * 1000) / 60;

  const cumulative = cumulativeDistances(route);
  const startIndex = nearestRouteIndex(route, currentCoordinate);
  const startDistance = cumulative[startIndex] ?? 0;
  const routeEnd = cumulative[cumulative.length - 1] ?? 0;
  const remainingM = Math.max(0, routeEnd - startDistance);

  if (remainingM < 50) {
    return {
      status: 'dry',
      summary: 'Tu es pratiquement arrivé au bout du parcours.',
      alert: null,
      checkedAt: Date.now(),
    };
  }

  const samples: Array<{ coordinate: [number, number]; etaMinutes: number; distanceAheadM: number }> = [];
  const maxMinutes = Math.min(180, Math.max(15, Math.ceil(remainingM / speedMPerMin)));

  for (let eta = 0; eta <= maxMinutes; eta += 15) {
    const ahead = Math.min(remainingM, eta * speedMPerMin);
    const coordinate = pointAtDistance(route, cumulative, startDistance + ahead);
    samples.push({ coordinate, etaMinutes: eta, distanceAheadM: ahead });
    if (ahead >= remainingM - 20) break;
  }

  if (!samples.length) {
    return { status: 'unavailable', summary: 'Prévision météo indisponible.', alert: null, checkedAt: Date.now() };
  }

  const latitudes = samples.map((s) => s.coordinate[1].toFixed(5)).join(',');
  const longitudes = samples.map((s) => s.coordinate[0].toFixed(5)).join(',');
  const params = new URLSearchParams({
    latitude: latitudes,
    longitude: longitudes,
    minutely_15: 'precipitation,rain,weather_code',
    forecast_minutely_15: '20',
    timezone: 'GMT',
    timeformat: 'unixtime',
  });

  try {
    const response = await fetch(`${OPEN_METEO_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const raw: any = await response.json();
    const locations: any[] = Array.isArray(raw) ? raw : [raw];
    const nowSeconds = Math.floor(Date.now() / 1000);

    let firstAlert: RouteWeatherAlert | null = null;

    for (let i = 0; i < samples.length; i++) {
      const weather = locations[Math.min(i, locations.length - 1)];
      const times: number[] = weather?.minutely_15?.time ?? [];
      const rain: number[] = weather?.minutely_15?.rain ?? [];
      const precipitation: number[] = weather?.minutely_15?.precipitation ?? [];
      const codes: number[] = weather?.minutely_15?.weather_code ?? [];
      const target = nowSeconds + samples[i].etaMinutes * 60;
      const index = nearestTimeIndex(times, target);
      if (index < 0) continue;

      const rainMm15 = Number(rain[index] ?? 0);
      const precipitationMm15 = Number(precipitation[index] ?? 0);
      const weatherCode = Number.isFinite(Number(codes[index])) ? Number(codes[index]) : null;
      const rainyCode = weatherCode != null && ((weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82) || weatherCode >= 95);

      if (rainMm15 >= 0.05 || (rainyCode && precipitationMm15 >= 0.05)) {
        firstAlert = {
          distanceAheadM: samples[i].distanceAheadM,
          etaMinutes: samples[i].etaMinutes,
          rainMm15,
          precipitationMm15,
          weatherCode,
          coordinate: samples[i].coordinate,
        };
        break;
      }
    }

    if (!firstAlert) {
      return {
        status: 'dry',
        summary: `Pas de pluie détectée sur les ${Math.round(maxMinutes / 15) * 15} prochaines minutes du parcours.`,
        alert: null,
        checkedAt: Date.now(),
      };
    }

    const distanceKm = firstAlert.distanceAheadM / 1000;
    const etaText = firstAlert.etaMinutes <= 0 ? 'maintenant' : `dans ${firstAlert.etaMinutes} min`;
    const placeText = firstAlert.distanceAheadM < 500 ? 'à proximité' : `à ${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km devant toi`;
    const amount = Math.max(firstAlert.rainMm15, firstAlert.precipitationMm15);

    return {
      status: 'rain',
      summary: `🌧 ${rainDescription(amount)} prévue ${etaText}, ${placeText} (${amount.toFixed(1)} mm/15 min).`,
      alert: firstAlert,
      checkedAt: Date.now(),
    };
  } catch {
    return {
      status: 'unavailable',
      summary: 'Prévision météo du parcours momentanément indisponible.',
      alert: null,
      checkedAt: Date.now(),
    };
  }
}
