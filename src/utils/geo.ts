import { ActivityStats, TrackPoint } from '../types/domain';

const R = 6371000;
const rad = (v: number) => (v * Math.PI) / 180;

function haversine(a: TrackPoint, b: TrackPoint) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface DetailedActivityStats extends ActivityStats {
  averageSpeedKmh: number;
  maxSpeedKmh: number;
  minAltitudeM: number | null;
  maxAltitudeM: number | null;
  startAltitudeM: number | null;
  endAltitudeM: number | null;
}

export function computeStats(points: TrackPoint[], startedAt: number, endedAt?: number | null): ActivityStats {
  const detailed = computeDetailedStats(points, startedAt, endedAt);
  return {
    distanceM: detailed.distanceM,
    durationS: detailed.durationS,
    ascentM: detailed.ascentM,
    descentM: detailed.descentM,
    currentSpeedKmh: detailed.currentSpeedKmh,
    altitudeM: detailed.altitudeM,
  };
}

export function computeDetailedStats(
  points: TrackPoint[],
  startedAt: number,
  endedAt?: number | null,
): DetailedActivityStats {
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  let maxSpeedKmh = 0;

  const altitudes = points
    .map((point) => point.altitude)
    .filter((value): value is number => value != null && Number.isFinite(value));

  for (const point of points) {
    if (point.speed != null && Number.isFinite(point.speed)) {
      maxSpeedKmh = Math.max(maxSpeedKmh, Math.max(0, point.speed * 3.6));
    }
  }

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const step = haversine(a, b);
    if (step < 150) distanceM += step;

    if (a.altitude != null && b.altitude != null) {
      const delta = b.altitude - a.altitude;
      if (Math.abs(delta) < 40) {
        if (delta > 0) ascentM += delta;
        else descentM += Math.abs(delta);
      }
    }
  }

  const last = points[points.length - 1];
  const durationS = Math.max(0, Math.floor(((endedAt ?? Date.now()) - startedAt) / 1000));
  const currentSpeedKmh = Math.max(0, (last?.speed ?? 0) * 3.6);
  const averageSpeedKmh = durationS > 0 ? (distanceM / 1000) / (durationS / 3600) : 0;

  return {
    distanceM,
    durationS,
    ascentM,
    descentM,
    currentSpeedKmh,
    altitudeM: last?.altitude ?? null,
    averageSpeedKmh,
    maxSpeedKmh,
    minAltitudeM: altitudes.length ? Math.min(...altitudes) : null,
    maxAltitudeM: altitudes.length ? Math.max(...altitudes) : null,
    startAltitudeM: points[0]?.altitude ?? null,
    endAltitudeM: last?.altitude ?? null,
  };
}

export function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
