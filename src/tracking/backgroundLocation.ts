import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getActiveActivity, initDb, insertTrackPointIfMeaningful } from '../storage/db';

export const LOCATION_TASK_NAME = 'VISOMOOT_BACKGROUND_LOCATION';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;

  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  if (!locations.length) return;

  await initDb();
  const activity = await getActiveActivity();
  if (!activity) return;

  for (const location of locations) {
    const c = location.coords;
    await insertTrackPointIfMeaningful({
      activityId: activity.id,
      latitude: c.latitude,
      longitude: c.longitude,
      altitude: c.altitude ?? null,
      accuracy: c.accuracy ?? null,
      speed: c.speed ?? null,
      heading: c.heading ?? null,
      timestamp: location.timestamp || Date.now(),
    });
  }
});

export async function ensureLocationPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;

  const bgCurrent = await Location.getBackgroundPermissionsAsync();
  if (bgCurrent.status === 'granted') return true;

  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}

export async function startBackgroundTracking() {
  const taskManagerAvailable = await TaskManager.isAvailableAsync();
  if (!taskManagerAvailable) {
    throw new Error('Le suivi GPS en arrière-plan n’est pas disponible sur cette installation.');
  }

  const backgroundAvailable = await Location.isBackgroundLocationAvailableAsync();
  if (!backgroundAvailable) {
    throw new Error('Android ne permet pas le suivi GPS en arrière-plan sur cet appareil.');
  }

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (alreadyStarted) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 3,
    timeInterval: 2000,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
    foregroundService: {
      notificationTitle: 'Visomoot — activité en cours',
      notificationBody: 'Enregistrement GPS en cours en arrière-plan.',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopBackgroundTracking() {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
}
