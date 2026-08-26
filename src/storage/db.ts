import * as SQLite from 'expo-sqlite';
import { Activity, SportType, TrackPoint } from '../types/domain';

const dbPromise = SQLite.openDatabaseAsync('visomoot.db');

export interface SavedRoute {
  id: number;
  name: string;
  sport: SportType;
  createdAt: number;
}

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function initDb() {
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sport TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      route_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS track_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude REAL,
      accuracy REAL,
      speed REAL,
      heading REAL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(activity_id) REFERENCES activities(id)
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sport TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      longitude REAL NOT NULL,
      latitude REAL NOT NULL,
      FOREIGN KEY(route_id) REFERENCES routes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_track_points_activity_time
      ON track_points(activity_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_route_points_route_seq
      ON route_points(route_id, seq);
  `);

  const activityColumns = await db.getAllAsync<any>('PRAGMA table_info(activities)');
  const hasRouteId = activityColumns.some((column) => column?.name === 'route_id');
  if (!hasRouteId) {
    await db.execAsync('ALTER TABLE activities ADD COLUMN route_id INTEGER;');
  }
}

export async function createActivity(sport: SportType, routeId: number | null = null): Promise<Activity> {
  const db = await dbPromise;
  const startedAt = Date.now();
  const result = await db.runAsync(
    'INSERT INTO activities (sport, state, started_at, route_id) VALUES (?, ?, ?, ?)',
    sport,
    'active',
    startedAt,
    routeId,
  );
  return {
    id: Number(result.lastInsertRowId),
    sport,
    state: 'active',
    startedAt,
    endedAt: null,
    routeId,
  };
}

export async function getUnfinishedActivity(): Promise<Activity | null> {
  const db = await dbPromise;
  const row = await db.getFirstAsync<any>(
    `SELECT id, sport, state, started_at AS startedAt, ended_at AS endedAt, route_id AS routeId
     FROM activities
     WHERE state IN ('active', 'paused')
     ORDER BY id DESC LIMIT 1`,
  );
  return row ? (row as Activity) : null;
}

export async function getActiveActivity(): Promise<Activity | null> {
  const db = await dbPromise;
  const row = await db.getFirstAsync<any>(
    `SELECT id, sport, state, started_at AS startedAt, ended_at AS endedAt, route_id AS routeId
     FROM activities WHERE state='active' ORDER BY id DESC LIMIT 1`,
  );
  return row ? (row as Activity) : null;
}

export async function setActivityState(id: number, state: 'active' | 'paused') {
  const db = await dbPromise;
  await db.runAsync('UPDATE activities SET state=? WHERE id=?', state, id);
}

export async function finishActivity(id: number) {
  const db = await dbPromise;
  await db.runAsync(
    "UPDATE activities SET state='finished', ended_at=? WHERE id=?",
    Date.now(),
    id,
  );
}

export async function insertTrackPoint(point: TrackPoint) {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT INTO track_points
     (activity_id, latitude, longitude, altitude, accuracy, speed, heading, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    point.activityId,
    point.latitude,
    point.longitude,
    point.altitude,
    point.accuracy,
    point.speed,
    point.heading,
    point.timestamp,
  );
}

export async function insertTrackPointIfMeaningful(sample: {
  activityId: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}) {
  const db = await dbPromise;
  const last = await db.getFirstAsync<TrackPoint>(
    `SELECT id, activity_id AS activityId, latitude, longitude, altitude,
            accuracy, speed, heading, timestamp
     FROM track_points WHERE activity_id=? ORDER BY timestamp DESC LIMIT 1`,
    sample.activityId,
  );

  if (last) {
    const deltaMs = Math.abs(sample.timestamp - last.timestamp);
    const deltaM = distanceMeters(last.latitude, last.longitude, sample.latitude, sample.longitude);

    if (deltaMs < 2000 && deltaM < 5) return false;
  }

  await insertTrackPoint({
    activityId: sample.activityId,
    latitude: sample.latitude,
    longitude: sample.longitude,
    altitude: sample.altitude,
    accuracy: sample.accuracy,
    speed: sample.speed,
    heading: sample.heading,
    timestamp: sample.timestamp,
  });

  return true;
}

export async function getTrackPoints(activityId: number): Promise<TrackPoint[]> {
  const db = await dbPromise;
  return db.getAllAsync<TrackPoint>(
    `SELECT id, activity_id AS activityId, latitude, longitude, altitude,
            accuracy, speed, heading, timestamp
     FROM track_points WHERE activity_id=? ORDER BY timestamp ASC`,
    activityId,
  );
}

export async function getRecentActivities(limit = 20): Promise<Activity[]> {
  const db = await dbPromise;
  return db.getAllAsync<Activity>(
    `SELECT id, sport, state, started_at AS startedAt, ended_at AS endedAt, route_id AS routeId
     FROM activities ORDER BY id DESC LIMIT ?`,
    limit,
  );
}

export async function saveRoute(
  sport: SportType,
  coordinates: Array<[number, number]>,
  nameOverride?: string,
): Promise<SavedRoute> {
  const db = await dbPromise;
  const createdAt = Date.now();
  const generatedName = `${sport === 'hiking' ? 'Randonnée' : sport === 'road_bike' ? 'Vélo route' : sport === 'gravel' ? 'Gravel' : 'VTT'} — ${new Date(createdAt).toLocaleDateString()}`;
  const name = nameOverride?.trim() || generatedName;

  const result = await db.runAsync(
    'INSERT INTO routes (name, sport, created_at) VALUES (?, ?, ?)',
    name,
    sport,
    createdAt,
  );
  const routeId = Number(result.lastInsertRowId);

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < coordinates.length; i++) {
      const [longitude, latitude] = coordinates[i];
      await db.runAsync(
        'INSERT INTO route_points (route_id, seq, longitude, latitude) VALUES (?, ?, ?, ?)',
        routeId,
        i,
        longitude,
        latitude,
      );
    }
  });

  return { id: routeId, name, sport, createdAt };
}

export async function getRoutePoints(routeId: number): Promise<Array<[number, number]>> {
  const db = await dbPromise;
  const rows = await db.getAllAsync<{ longitude: number; latitude: number }>(
    'SELECT longitude, latitude FROM route_points WHERE route_id=? ORDER BY seq ASC',
    routeId,
  );
  return rows.map((row) => [Number(row.longitude), Number(row.latitude)] as [number, number]);
}

export async function deleteActivity(id: number) {
  const db = await dbPromise;
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM track_points WHERE activity_id=?', id);
    await db.runAsync('DELETE FROM activities WHERE id=?', id);
  });
}
