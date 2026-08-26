export type SportType = 'hiking' | 'road_bike' | 'gravel' | 'mtb';
export type ActivityState = 'active' | 'paused' | 'finished';

export interface Activity {
  id: number;
  sport: SportType;
  state: ActivityState;
  startedAt: number;
  endedAt: number | null;
  routeId?: number | null;
}

export interface TrackPoint {
  id?: number;
  activityId: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface ActivityStats {
  distanceM: number;
  durationS: number;
  ascentM: number;
  descentM: number;
  currentSpeedKmh: number;
  altitudeM: number | null;
}
