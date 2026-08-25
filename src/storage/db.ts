import * as SQLite from 'expo-sqlite';
import { Activity, SportType, TrackPoint } from '../types/domain';

const dbPromise = SQLite.openDatabaseAsync('randoradar.db');

export interface SavedRoute {
  id: number;
  name: string;
  sport: SportType;
  createdAt: number;
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
      ended_at INTEGER
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
}

export async function createActivity(sport: SportType): Promise<Activity> {
  const db = await dbPromise;
  const startedAt = Date.now();
  const result = await db.runAsync(
    'INSERT INTO activities (sport, state, started_at) VALUES (?, ?, ?)',
    sport,
    'active',
    startedAt,
  );
  return {
    id: Number(result.lastInsertRowId),
    sport,
    state: 'active',
    startedAt,
    endedAt: null,
  };
}

export async function getUnfinishedActivity(): Promise<Activity | null> {
  const db = await dbPromise;
  const row = await db.getFirstAsync<any>(
    `SELECT id, sport, state, started_at AS startedAt, ended_at AS endedAt
     FROM activities
     WHERE state IN ('active', 'paused')
     ORDER BY id DESC LIMIT 1`,
  );
  return row ? (row as Activity) : null;
}

export async function getActiveActivity(): Promise<Activity | null> {
  const db = await dbPromise;
  const row = await db.getFirstAsync<any>(
    `SELECT id, sport, state, started_at AS startedAt, ended_at AS endedAt
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
    `SELECT id, sport, state, started_at AS startedAt, ended_at AS endedAt
     FROM activities ORDER BY id DESC LIMIT ?`,
    limit,
  );
}

export async function saveRoute(
  sport: SportType,
  coordinates: Array<[number, number]>,
): Promise<SavedRoute> {
  const db = await dbPromise;
  const createdAt = Date.now();
  const name = `${sport === 'hiking' ? 'Randonnée' : sport === 'road_bike' ? 'Vélo route' : sport === 'gravel' ? 'Gravel' : 'VTT'} — ${new Date(createdAt).toLocaleDateString()}`;

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
