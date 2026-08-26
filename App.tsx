import './src/tracking/backgroundLocation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  RasterSource,
} from '@maplibre/maplibre-react-native';
import {
  createActivity,
  finishActivity,
  getRecentActivities,
  getRoutePoints,
  getTrackPoints,
  getUnfinishedActivity,
  initDb,
  insertTrackPointIfMeaningful,
  saveRoute,
  setActivityState,
} from './src/storage/db';
import {
  ensureLocationPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
} from './src/tracking/backgroundLocation';
import { getLatestRadarFrame, RadarFrame } from './src/services/rainviewer';
import { routeViaWaypoints, RoutedPath } from './src/services/routing';
import {
  defaultSportSpeedKmh,
  forecastRainAhead,
  RouteWeatherResult,
} from './src/services/routeWeather';
import { Activity, SportType, TrackPoint } from './src/types/domain';
import { computeStats, formatDuration } from './src/utils/geo';
import { routeDistanceM } from './src/utils/route';

const MAP_STYLE = {
  version: 8,
  sources: {
    opentopo: {
      type: 'raster',
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors, SRTM | OpenTopoMap',
    },
  },
  layers: [{ id: 'opentopo-base', type: 'raster', source: 'opentopo' }],
};

const SPORTS: Array<{ id: SportType; label: string }> = [
  { id: 'hiking', label: '🥾 Randonnée' },
  { id: 'road_bike', label: '🚴 Route' },
  { id: 'gravel', label: '🚲 Gravel' },
  { id: 'mtb', label: '⛰️ VTT' },
];

const sportLabel = (sport: SportType) => SPORTS.find((s) => s.id === sport)?.label ?? sport;

function humanRouteTime(seconds: number) {
  if (!seconds || seconds <= 0) return '';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export default function App() {
  const appStateRef = useRef(AppState.currentState);
  const cameraRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const liveCoordinateRef = useRef<[number, number] | null>(null);
  const liveSpeedRef = useRef<number | null>(null);

  const [sport, setSport] = useState<SportType>('hiking');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [liveCoordinate, setLiveCoordinate] = useState<[number, number] | null>(null);

  const [planning, setPlanning] = useState(false);
  const [plannedWaypoints, setPlannedWaypoints] = useState<Array<[number, number]>>([]);
  const [plannedPoints, setPlannedPoints] = useState<Array<[number, number]>>([]);
  const [routeSummary, setRouteSummary] = useState<RoutedPath | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedRoutePoints, setSelectedRoutePoints] = useState<Array<[number, number]>>([]);
  const [activeRoutePoints, setActiveRoutePoints] = useState<Array<[number, number]>>([]);

  const [routeWeather, setRouteWeather] = useState<RouteWeatherResult | null>(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherTick, setWeatherTick] = useState(0);

  const [radarEnabled, setRadarEnabled] = useState(false);
  const [radar, setRadar] = useState<RadarFrame | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Activity[]>([]);
  const [initialCenter, setInitialCenter] = useState<[number, number]>([7.2619, 43.7102]);

  const setLivePosition = (coordinate: [number, number], speedMps?: number | null) => {
    liveCoordinateRef.current = coordinate;
    setLiveCoordinate(coordinate);
    if (speedMps != null && Number.isFinite(speedMps)) liveSpeedRef.current = Math.max(0, speedMps * 3.6);
  };

  const refreshWeather = async (
    route: Array<[number, number]>,
    targetSport: SportType,
    current: [number, number] | null = null,
    speedKmh?: number | null,
  ) => {
    if (route.length < 2) {
      setRouteWeather(null);
      return;
    }

    setWeatherBusy(true);
    try {
      const forecast = await forecastRainAhead(route, targetSport, current, speedKmh);
      setRouteWeather(forecast);
    } finally {
      setWeatherBusy(false);
    }
  };

  const loadUnfinishedActivity = async () => {
    const unfinished = await getUnfinishedActivity();
    if (!unfinished) return;

    const loadedPoints = await getTrackPoints(unfinished.id);
    setActivity(unfinished);
    setSport(unfinished.sport);
    setPoints(loadedPoints);

    if (unfinished.routeId) {
      const route = await getRoutePoints(unfinished.routeId);
      setSelectedRouteId(unfinished.routeId);
      setSelectedRoutePoints(route);
      setActiveRoutePoints(route);
    }

    const lastPoint = loadedPoints[loadedPoints.length - 1];
    if (lastPoint) {
      const center: [number, number] = [lastPoint.longitude, lastPoint.latitude];
      setInitialCenter(center);
      setLivePosition(center, lastPoint.speed);
    }

    if (unfinished.state === 'active') {
      try {
        const bg = await Location.getBackgroundPermissionsAsync();
        if (bg.status === 'granted') await startBackgroundTracking();
      } catch {
        // l'activité reste récupérable même si Android refuse momentanément de relancer le service
      }
    }
  };

  useEffect(() => {
    (async () => {
      await initDb();
      await loadUnfinishedActivity();

      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status === 'granted') {
        const last = await Location.getLastKnownPositionAsync();
        if (last) {
          const center: [number, number] = [last.coords.longitude, last.coords.latitude];
          setInitialCenter(center);
          setLivePosition(center, last.coords.speed);
        }
      }
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (previous.match(/inactive|background/) && nextState === 'active') {
        await loadUnfinishedActivity();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!activity) return;
    const timer = setInterval(async () => {
      const loaded = await getTrackPoints(activity.id);
      setPoints(loaded);
      const last = loaded[loaded.length - 1];
      if (last) {
        const center: [number, number] = [last.longitude, last.latitude];
        setLivePosition(center, last.speed);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activity?.id]);

  useEffect(() => {
    if (!activity) return;
    const timer = setInterval(() => setWeatherTick((value) => value + 1), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [activity?.id]);

  useEffect(() => {
    if (!activity || activeRoutePoints.length < 2) return;
    const speed = liveSpeedRef.current && liveSpeedRef.current >= 2
      ? liveSpeedRef.current
      : defaultSportSpeedKmh(activity.sport);
    refreshWeather(activeRoutePoints, activity.sport, liveCoordinateRef.current, speed);
  }, [activity?.id, activity?.state, activeRoutePoints, weatherTick]);

  useEffect(() => {
    if (!radarEnabled) return;
    let alive = true;

    const refresh = async () => {
      try {
        const frame = await getLatestRadarFrame();
        if (alive) setRadar(frame);
      } catch {
        if (alive) setRadar(null);
      }
    };

    refresh();
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [radarEnabled]);

  const stats = useMemo(
    () => (activity ? computeStats(points, activity.startedAt, activity.endedAt) : null),
    [activity, points],
  );

  const actualTrackGeoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: points.map((p) => [p.longitude, p.latitude]) },
    }),
    [points],
  );

  const plannedLineGeoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: plannedPoints },
    }),
    [plannedPoints],
  );

  const plannedWaypointGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: plannedWaypoints.map((coordinate, index) => ({
        type: 'Feature' as const,
        properties: { index: index + 1 },
        geometry: { type: 'Point' as const, coordinates: coordinate },
      })),
    }),
    [plannedWaypoints],
  );

  const displayRoutePoints = activity ? activeRoutePoints : selectedRoutePoints;
  const selectedLineGeoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: displayRoutePoints },
    }),
    [displayRoutePoints],
  );

  const livePointGeoJson = useMemo(
    () => liveCoordinate ? ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: liveCoordinate },
    }) : null,
    [liveCoordinate],
  );

  const weatherPointGeoJson = useMemo(() => {
    if (!routeWeather?.alert) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: routeWeather.alert.coordinate },
    };
  }, [routeWeather]);

  const plannedDistance = useMemo(
    () => routeSummary?.distanceM ?? routeDistanceM(plannedPoints),
    [routeSummary, plannedPoints],
  );
  const selectedDistance = useMemo(() => routeDistanceM(selectedRoutePoints), [selectedRoutePoints]);

  const calculatePlannerRoute = async (waypoints: Array<[number, number]>, targetSport: SportType) => {
    setRouteError(null);
    setRouteWeather(null);

    if (waypoints.length === 0) {
      setPlannedPoints([]);
      setRouteSummary(null);
      return;
    }

    if (waypoints.length === 1) {
      setPlannedPoints([waypoints[0]]);
      setRouteSummary(null);
      return;
    }

    setRouteBusy(true);
    try {
      const routed = await routeViaWaypoints(waypoints, targetSport);
      setPlannedPoints(routed.coordinates);
      setRouteSummary(routed);
      const averageSpeed = routed.durationS > 0
        ? (routed.distanceM / 1000) / (routed.durationS / 3600)
        : defaultSportSpeedKmh(targetSport);
      await refreshWeather(routed.coordinates, targetSport, null, averageSpeed);
    } catch (error: any) {
      setRouteError(error?.message || 'Impossible de calculer le parcours.');
    } finally {
      setRouteBusy(false);
    }
  };

  const selectSport = async (nextSport: SportType) => {
    if (activity) return;
    setSport(nextSport);
    if (planning && plannedWaypoints.length >= 2) {
      await calculatePlannerRoute(plannedWaypoints, nextSport);
    }
  };

  const centerOnGps = async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        Alert.alert('GPS non autorisé', 'Autorise la localisation précise pour afficher ta position sur la carte.');
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const center: [number, number] = [current.coords.longitude, current.coords.latitude];
      setLivePosition(center, current.coords.speed);
      setInitialCenter(center);

      if (mapReady) {
        await cameraRef.current?.easeTo({
          center,
          zoom: activity?.state === 'active' ? 15.5 : 16,
          duration: 450,
        });
      }
    } catch (error: any) {
      Alert.alert('Position GPS', error?.message || 'Impossible de récupérer la position pour le moment.');
    }
  };

  const start = async () => {
    if (activity) return;
    setPlanning(false);

    try {
      const ok = await ensureLocationPermissions();
      if (!ok) {
        Alert.alert(
          'Autorisation GPS nécessaire',
          "Pour enregistrer une activité écran éteint, autorise la localisation en permanence dans les réglages du téléphone.",
        );
        return;
      }

      const routeForActivity = selectedRouteId ? selectedRoutePoints : [];
      const created = await createActivity(sport, selectedRouteId);

      try {
        try {
          const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const center: [number, number] = [current.coords.longitude, current.coords.latitude];
          setLivePosition(center, current.coords.speed);
          setInitialCenter(center);

          await insertTrackPointIfMeaningful({
            activityId: created.id,
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
            altitude: current.coords.altitude ?? null,
            accuracy: current.coords.accuracy ?? null,
            speed: current.coords.speed ?? null,
            heading: current.coords.heading ?? null,
            timestamp: current.timestamp || Date.now(),
          });
        } catch {
          // Le premier fix peut arriver quelques secondes après le départ.
        }

        await startBackgroundTracking();
      } catch (trackingError) {
        await finishActivity(created.id);
        throw trackingError;
      }

      setActivity(created);
      setActiveRoutePoints(routeForActivity);
      setPoints(await getTrackPoints(created.id));
      setExpanded(true);
    } catch (error: any) {
      Alert.alert('Erreur Visomoot', error?.message || 'Impossible de démarrer l’activité.');
    }
  };

  const pauseResume = async () => {
    if (!activity) return;
    try {
      if (activity.state === 'active') {
        await stopBackgroundTracking();
        await setActivityState(activity.id, 'paused');
        setActivity({ ...activity, state: 'paused' });
      } else {
        await setActivityState(activity.id, 'active');
        try {
          await startBackgroundTracking();
          setActivity({ ...activity, state: 'active' });
        } catch (trackingError) {
          await setActivityState(activity.id, 'paused');
          throw trackingError;
        }
      }
    } catch (error: any) {
      Alert.alert('Erreur Visomoot', error?.message || 'Impossible de changer l’état de l’activité.');
    }
  };

  const stop = () => {
    if (!activity) return;
    Alert.alert('Terminer l’activité ?', 'Le parcours restera enregistré dans le téléphone.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Terminer',
        style: 'destructive',
        onPress: async () => {
          try {
            await stopBackgroundTracking();
            await finishActivity(activity.id);
            setActivity(null);
            setPoints([]);
            setActiveRoutePoints([]);
            setRouteWeather(null);
          } catch (error: any) {
            Alert.alert('Erreur Visomoot', error?.message || 'Impossible de terminer l’activité.');
          }
        },
      },
    ]);
  };

  const openHistory = async () => {
    setHistory(await getRecentActivities());
    setHistoryOpen(true);
  };

  const togglePlanning = () => {
    if (activity) return;
    setPlanning((value) => !value);
    setRouteError(null);
  };

  const onMapPress = async (event: any) => {
    if (!planning || activity || routeBusy) return;
    const lngLat = event?.nativeEvent?.lngLat;
    if (!Array.isArray(lngLat) || lngLat.length < 2) return;
    const coordinate: [number, number] = [Number(lngLat[0]), Number(lngLat[1])];
    const nextWaypoints = [...plannedWaypoints, coordinate];
    setPlannedWaypoints(nextWaypoints);
    await calculatePlannerRoute(nextWaypoints, sport);
  };

  const undoPlanningPoint = async () => {
    if (routeBusy || plannedWaypoints.length === 0) return;
    const nextWaypoints = plannedWaypoints.slice(0, -1);
    setPlannedWaypoints(nextWaypoints);
    await calculatePlannerRoute(nextWaypoints, sport);
  };

  const clearPlanning = () => {
    if (routeBusy) return;
    setPlannedWaypoints([]);
    setPlannedPoints([]);
    setRouteSummary(null);
    setRouteWeather(null);
    setRouteError(null);
  };

  const savePlannedRoute = async () => {
    if (plannedWaypoints.length < 2 || plannedPoints.length < 2) {
      Alert.alert('Parcours incomplet', 'Ajoute au moins un départ et une arrivée sur la carte.');
      return;
    }

    const route = await saveRoute(sport, plannedPoints);
    setSelectedRouteId(route.id);
    setSelectedRoutePoints(plannedPoints);
    Alert.alert('Parcours prêt', `${route.name}\n${(plannedDistance / 1000).toFixed(2)} km`);
    setPlanning(false);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <Map
        style={styles.map}
        mapStyle={MAP_STYLE as any}
        androidView="texture"
        logo
        attribution
        compass
        onPress={onMapPress}
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: initialCenter, zoom: 13 }}
          center={activity?.state === 'active' && liveCoordinate ? liveCoordinate : undefined}
          zoom={activity?.state === 'active' ? 15.5 : undefined}
          duration={350}
          easing="ease"
        />

        {livePointGeoJson && (
          <GeoJSONSource id="live-gps-position" data={livePointGeoJson}>
            <Layer
              id="live-gps-position-point"
              type="circle"
              source="live-gps-position"
              paint={{
                'circle-radius': 8,
                'circle-color': '#1976D2',
                'circle-stroke-color': '#FFFFFF',
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        )}

        {!planning && displayRoutePoints.length >= 2 && (
          <GeoJSONSource id="selected-route" data={selectedLineGeoJson}>
            <Layer
              id="selected-route-line"
              type="line"
              source="selected-route"
              paint={{ 'line-color': '#E05B21', 'line-width': 6, 'line-opacity': 0.82 }}
            />
          </GeoJSONSource>
        )}

        {points.length >= 2 && (
          <GeoJSONSource id="activity-track" data={actualTrackGeoJson}>
            <Layer
              id="activity-line"
              type="line"
              source="activity-track"
              paint={{ 'line-color': '#1565C0', 'line-width': 5, 'line-opacity': 0.95 }}
            />
          </GeoJSONSource>
        )}

        {planning && plannedPoints.length >= 2 && (
          <GeoJSONSource id="planned-route" data={plannedLineGeoJson}>
            <Layer
              id="planned-route-line"
              type="line"
              source="planned-route"
              paint={{ 'line-color': '#E05B21', 'line-width': 6, 'line-opacity': 0.95 }}
            />
          </GeoJSONSource>
        )}

        {planning && plannedWaypoints.length > 0 && (
          <GeoJSONSource id="planned-waypoints" data={plannedWaypointGeoJson}>
            <Layer
              id="planned-waypoints-layer"
              type="circle"
              source="planned-waypoints"
              paint={{
                'circle-radius': 7,
                'circle-color': '#FFFFFF',
                'circle-stroke-color': '#E05B21',
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        )}

        {weatherPointGeoJson && (
          <GeoJSONSource id="weather-alert" data={weatherPointGeoJson}>
            <Layer
              id="weather-alert-point"
              type="circle"
              source="weather-alert"
              paint={{
                'circle-radius': 10,
                'circle-color': '#1976D2',
                'circle-stroke-color': '#FFFFFF',
                'circle-stroke-width': 4,
              }}
            />
          </GeoJSONSource>
        )}

        {radarEnabled && radar && (
          <RasterSource
            id="rainviewer-radar"
            tiles={[radar.tileUrl]}
            tileSize={256}
            minzoom={0}
            maxzoom={7}
            attribution="Weather data by RainViewer"
          >
            <Layer
              id="rainviewer-radar-layer"
              type="raster"
              source="rainviewer-radar"
              paint={{ 'raster-opacity': 0.6 }}
            />
          </RasterSource>
        )}
      </Map>

      <View style={styles.gpsButtonWrap} pointerEvents="box-none">
        <Pressable onPress={centerOnGps} style={styles.gpsButton} accessibilityLabel="Centrer la carte sur ma position GPS">
          <Text style={styles.gpsButtonIcon}>⌖</Text>
          <Text style={styles.gpsButtonLabel}>GPS</Text>
        </Pressable>
      </View>

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topBar}>
          <View style={styles.sportsRow}>
            {SPORTS.map((item) => (
              <Pressable
                key={item.id}
                disabled={!!activity || routeBusy}
                onPress={() => selectSport(item.id)}
                style={[styles.sportChip, sport === item.id && styles.sportChipActive]}
              >
                <Text style={[styles.sportText, sport === item.id && styles.sportTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => setRadarEnabled((v) => !v)}
              style={[styles.actionButton, radarEnabled && styles.radarActive]}
            >
              <Text style={styles.actionText}>🌧 Radar</Text>
            </Pressable>
            <Pressable
              disabled={!!activity}
              onPress={togglePlanning}
              style={[styles.actionButton, planning && styles.createActive, !!activity && styles.disabled]}
            >
              <Text style={styles.actionText}>✏️ Créer</Text>
            </Pressable>
            <Pressable onPress={openHistory} style={styles.actionButton}>
              <Text style={styles.actionText}>🕘 Activités</Text>
            </Pressable>
          </View>
        </View>

        {!activity && planning ? (
          <View style={styles.plannerCard}>
            <View style={styles.plannerHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.cardTitle}>Création de parcours</Text>
                <Text style={styles.cardSubTitle}>Touchez la carte : le tracé suit automatiquement routes et chemins.</Text>
              </View>
              <Pressable onPress={() => setPlanning(false)}>
                <Text style={styles.closePlanner}>Fermer</Text>
              </Pressable>
            </View>

            <View style={styles.plannerSummary}>
              <Text style={styles.plannerDistance}>
                {routeBusy ? 'Calcul…' : `${(plannedDistance / 1000).toFixed(2)} km`}
              </Text>
              <Text style={styles.plannerMeta}>
                {plannedWaypoints.length} étape{plannedWaypoints.length > 1 ? 's' : ''}
                {routeSummary?.durationS ? ` · ${humanRouteTime(routeSummary.durationS)}` : ''}
                {' · '}routage {sport === 'hiking' ? 'piéton/sentiers' : sport === 'road_bike' ? 'vélo route' : sport === 'gravel' ? 'gravel' : 'VTT'}
              </Text>
              {routeError && <Text style={styles.routeError}>{routeError}</Text>}
            </View>

            <WeatherStrip forecast={routeWeather} loading={weatherBusy || routeBusy} />

            <View style={styles.plannerButtons}>
              <Pressable
                onPress={undoPlanningPoint}
                disabled={plannedWaypoints.length === 0 || routeBusy}
                style={[styles.plannerSmallButton, (plannedWaypoints.length === 0 || routeBusy) && styles.disabled]}
              >
                <Text style={styles.plannerSmallText}>↶ Annuler</Text>
              </Pressable>
              <Pressable
                onPress={clearPlanning}
                disabled={plannedWaypoints.length === 0 || routeBusy}
                style={[styles.plannerSmallButton, (plannedWaypoints.length === 0 || routeBusy) && styles.disabled]}
              >
                <Text style={styles.plannerSmallText}>🗑 Effacer</Text>
              </Pressable>
              <Pressable
                onPress={savePlannedRoute}
                disabled={plannedWaypoints.length < 2 || routeBusy}
                style={[styles.saveRouteButton, (plannedWaypoints.length < 2 || routeBusy) && styles.disabled]}
              >
                <Text style={styles.saveRouteText}>Enregistrer</Text>
              </Pressable>
            </View>
          </View>
        ) : !activity ? (
          <View style={styles.startWrap}>
            {selectedRoutePoints.length >= 2 && (
              <View style={styles.readyRouteCard}>
                <Text style={styles.readyRouteTitle}>🧭 Parcours prêt · {(selectedDistance / 1000).toFixed(2)} km</Text>
                <WeatherStrip forecast={routeWeather} loading={weatherBusy} compact />
              </View>
            )}
            <Pressable onPress={start} style={styles.startButton}>
              <Text style={styles.startButtonText}>Démarrer — {sportLabel(sport)}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.activityCard, !expanded && styles.activityCardCollapsed]}>
            <Pressable style={styles.cardHeader} onPress={() => setExpanded((v) => !v)}>
              <View>
                <Text style={styles.cardTitle}>{sportLabel(activity.sport)} en cours</Text>
                <Text style={styles.cardSubTitle}>
                  {activity.state === 'paused' ? 'En pause' : 'GPS actif en arrière-plan'} · toucher pour {expanded ? 'réduire' : 'agrandir'}
                </Text>
              </View>
              <Text style={styles.chevron}>{expanded ? '⌄' : '⌃'}</Text>
            </Pressable>

            {expanded && stats && (
              <>
                {activeRoutePoints.length >= 2 && <WeatherStrip forecast={routeWeather} loading={weatherBusy} />}

                <View style={styles.statsGrid}>
                  <Stat label="Distance" value={`${(stats.distanceM / 1000).toFixed(2)} km`} />
                  <Stat label="Temps" value={formatDuration(stats.durationS)} />
                  <Stat label="D+" value={`${Math.round(stats.ascentM)} m`} />
                  <Stat label="Altitude" value={stats.altitudeM == null ? '—' : `${Math.round(stats.altitudeM)} m`} />
                  <Stat label="Vitesse" value={`${stats.currentSpeedKmh.toFixed(1)} km/h`} />
                  <Stat label="Points GPS" value={`${points.length}`} />
                </View>

                <View style={styles.cardButtons}>
                  <Pressable onPress={pauseResume} style={styles.secondaryButton}>
                    <Text style={styles.secondaryText}>{activity.state === 'active' ? 'Pause' : 'Reprendre'}</Text>
                  </Pressable>
                  <Pressable onPress={stop} style={styles.stopButton}>
                    <Text style={styles.stopText}>Terminer</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}
      </SafeAreaView>

      {radarEnabled && (
        <View style={styles.attributionBox} pointerEvents="none">
          <Text style={styles.attributionText}>
            Radar RainViewer{radar ? ` · ${new Date(radar.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' · chargement…'}
          </Text>
        </View>
      )}

      <Modal visible={historyOpen} animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <SafeAreaView style={styles.historyScreen}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Mes activités</Text>
            <Pressable onPress={() => setHistoryOpen(false)}>
              <Text style={styles.close}>Fermer</Text>
            </Pressable>
          </View>
          <FlatList
            data={history}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <View style={styles.historyItem}>
                <Text style={styles.historyItemTitle}>{sportLabel(item.sport)}</Text>
                <Text style={styles.historyItemSub}>
                  {new Date(item.startedAt).toLocaleString()} · {item.state === 'finished' ? 'Terminée' : item.state === 'paused' ? 'En pause' : 'En cours'}
                </Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>Aucune activité enregistrée.</Text>}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function WeatherStrip({
  forecast,
  loading,
  compact = false,
}: {
  forecast: RouteWeatherResult | null;
  loading: boolean;
  compact?: boolean;
}) {
  const text = loading
    ? '🌦 Analyse météo du parcours…'
    : forecast?.summary ?? '🌦 La météo du parcours apparaîtra ici.';

  return (
    <View style={[styles.weatherStrip, forecast?.status === 'rain' && styles.weatherStripRain, compact && styles.weatherStripCompact]}>
      <Text style={styles.weatherText}>{text}</Text>
      {!loading && forecast && (
        <Text style={styles.weatherSource}>Prévision 15 min · Open-Meteo / modèles locaux dont AROME en France</Text>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#EEF2F4' },
  map: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', pointerEvents: 'box-none' },
  topBar: { paddingHorizontal: 10, paddingTop: 8, gap: 8 },
  sportsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sportChip: { backgroundColor: 'rgba(255,255,255,0.94)', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18 },
  sportChipActive: { backgroundColor: '#163F2B' },
  sportText: { fontSize: 12, fontWeight: '700', color: '#23352D' },
  sportTextActive: { color: '#FFFFFF' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionButton: { backgroundColor: 'rgba(255,255,255,0.96)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16 },
  radarActive: { backgroundColor: '#DDEBFF' },
  createActive: { backgroundColor: '#FFE9DE' },
  disabled: { opacity: 0.42 },
  actionText: { fontWeight: '800', color: '#24343D' },

  gpsButtonWrap: { position: 'absolute', right: 12, top: 150 },
  gpsButton: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.97)', alignItems: 'center', justifyContent: 'center', elevation: 7 },
  gpsButtonIcon: { fontSize: 25, lineHeight: 25, fontWeight: '900', color: '#1565C0' },
  gpsButtonLabel: { marginTop: 1, fontSize: 9, fontWeight: '900', color: '#31566F' },

  startWrap: { padding: 14, gap: 9 },
  startButton: { backgroundColor: '#163F2B', borderRadius: 22, paddingVertical: 16, alignItems: 'center', elevation: 5 },
  startButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  readyRouteCard: { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 18, padding: 11, elevation: 4 },
  readyRouteTitle: { fontWeight: '900', color: '#172A22', marginBottom: 7 },

  plannerCard: { margin: 10, backgroundColor: 'rgba(255,255,255,0.98)', borderRadius: 24, padding: 14, elevation: 8 },
  plannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closePlanner: { color: '#1565C0', fontWeight: '800' },
  plannerSummary: { marginTop: 12, backgroundColor: '#FFF4EE', borderRadius: 16, padding: 12 },
  plannerDistance: { fontSize: 22, fontWeight: '900', color: '#A84418' },
  plannerMeta: { marginTop: 2, color: '#7A6257', fontSize: 12 },
  routeError: { marginTop: 7, fontSize: 12, fontWeight: '700', color: '#A62828' },
  plannerButtons: { flexDirection: 'row', gap: 8, marginTop: 12 },
  plannerSmallButton: { paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#ECEFED', borderRadius: 14, alignItems: 'center' },
  plannerSmallText: { fontWeight: '800', color: '#36453E' },
  saveRouteButton: { flex: 1, paddingVertical: 12, backgroundColor: '#E05B21', borderRadius: 14, alignItems: 'center' },
  saveRouteText: { color: '#FFFFFF', fontWeight: '900' },

  weatherStrip: { marginTop: 10, backgroundColor: '#EAF4FF', borderRadius: 14, padding: 10 },
  weatherStripRain: { backgroundColor: '#DCEBFF' },
  weatherStripCompact: { marginTop: 0 },
  weatherText: { color: '#173A5E', fontWeight: '800', fontSize: 12 },
  weatherSource: { marginTop: 4, color: '#61778B', fontSize: 9 },

  activityCard: { margin: 10, backgroundColor: 'rgba(255,255,255,0.98)', borderRadius: 24, padding: 14, elevation: 8 },
  activityCardCollapsed: { paddingBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 17, fontWeight: '900', color: '#172A22' },
  cardSubTitle: { marginTop: 2, color: '#64716C', fontSize: 12 },
  chevron: { fontSize: 28, fontWeight: '900', color: '#42564D' },
  statsGrid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBox: { width: '31.5%', minWidth: 96, backgroundColor: '#F1F5F3', borderRadius: 16, paddingVertical: 11, paddingHorizontal: 8 },
  statValue: { fontSize: 16, fontWeight: '900', color: '#172A22' },
  statLabel: { marginTop: 2, fontSize: 11, color: '#6E7B75' },
  cardButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondaryButton: { flex: 1, paddingVertical: 13, borderRadius: 16, backgroundColor: '#E7ECE9', alignItems: 'center' },
  secondaryText: { fontWeight: '900', color: '#263A31' },
  stopButton: { flex: 1, paddingVertical: 13, borderRadius: 16, backgroundColor: '#A62828', alignItems: 'center' },
  stopText: { fontWeight: '900', color: '#FFFFFF' },

  attributionBox: { position: 'absolute', right: 8, bottom: 118, backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  attributionText: { fontSize: 10, color: '#3D4B45' },

  historyScreen: { flex: 1, backgroundColor: '#F5F7F6' },
  historyHeader: { padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#CDD5D1' },
  historyTitle: { fontSize: 23, fontWeight: '900', color: '#172A22' },
  close: { color: '#1565C0', fontWeight: '800' },
  historyItem: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 10 },
  historyItemTitle: { fontSize: 16, fontWeight: '800', color: '#172A22' },
  historyItemSub: { marginTop: 5, color: '#697770' },
  empty: { textAlign: 'center', marginTop: 40, color: '#6B7772' },
});
