import './src/tracking/backgroundLocation';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
  UserLocation,
} from '@maplibre/maplibre-react-native';
import {
  createActivity,
  finishActivity,
  getRecentActivities,
  getTrackPoints,
  getUnfinishedActivity,
  initDb,
  saveRoute,
  setActivityState,
} from './src/storage/db';
import {
  ensureLocationPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
} from './src/tracking/backgroundLocation';
import { getLatestRadarFrame, RadarFrame } from './src/services/rainviewer';
import { Activity, SportType, TrackPoint } from './src/types/domain';
import { computeStats, formatDuration } from './src/utils/geo';
import { routeDistanceM } from './src/utils/route';

const MAP_STYLE = 'https://demotiles.maplibre.org/style.json';
const SPORTS: Array<{ id: SportType; label: string }> = [
  { id: 'hiking', label: '🥾 Randonnée' },
  { id: 'road_bike', label: '🚴 Route' },
  { id: 'gravel', label: '🚲 Gravel' },
  { id: 'mtb', label: '⛰️ VTT' },
];

const sportLabel = (sport: SportType) => SPORTS.find((s) => s.id === sport)?.label ?? sport;

export default function App() {
  const [sport, setSport] = useState<SportType>('hiking');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [expanded, setExpanded] = useState(true);

  const [planning, setPlanning] = useState(false);
  const [plannedPoints, setPlannedPoints] = useState<Array<[number, number]>>([]);

  const [radarEnabled, setRadarEnabled] = useState(false);
  const [radar, setRadar] = useState<RadarFrame | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Activity[]>([]);
  const [initialCenter, setInitialCenter] = useState<[number, number]>([7.2619, 43.7102]);

  useEffect(() => {
    (async () => {
      await initDb();
      const unfinished = await getUnfinishedActivity();
      if (unfinished) {
        setActivity(unfinished);
        setSport(unfinished.sport);
        setPoints(await getTrackPoints(unfinished.id));
      }

      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status === 'granted') {
        const last = await Location.getLastKnownPositionAsync();
        if (last) setInitialCenter([last.coords.longitude, last.coords.latitude]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activity) return;
    const timer = setInterval(async () => {
      setPoints(await getTrackPoints(activity.id));
    }, 1500);
    return () => clearInterval(timer);
  }, [activity?.id]);

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

  const lineGeoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: points.map((p) => [p.longitude, p.latitude]),
      },
    }),
    [points],
  );

  const plannedLineGeoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: plannedPoints,
      },
    }),
    [plannedPoints],
  );

  const plannedPointGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: plannedPoints.map((coordinate, index) => ({
        type: 'Feature' as const,
        properties: { index: index + 1 },
        geometry: { type: 'Point' as const, coordinates: coordinate },
      })),
    }),
    [plannedPoints],
  );

  const plannedDistance = useMemo(() => routeDistanceM(plannedPoints), [plannedPoints]);

  const start = async () => {
    if (activity) return;
    setPlanning(false);

    const ok = await ensureLocationPermissions();
    if (!ok) {
      Alert.alert(
        'Autorisation GPS nécessaire',
        "Pour enregistrer une activité écran éteint, autorise la localisation en permanence dans les réglages du téléphone.",
      );
      return;
    }

    const created = await createActivity(sport);
    setActivity(created);
    setPoints([]);
    setExpanded(true);
    await startBackgroundTracking();
  };

  const pauseResume = async () => {
    if (!activity) return;

    if (activity.state === 'active') {
      await stopBackgroundTracking();
      await setActivityState(activity.id, 'paused');
      setActivity({ ...activity, state: 'paused' });
    } else {
      await setActivityState(activity.id, 'active');
      setActivity({ ...activity, state: 'active' });
      await startBackgroundTracking();
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
          await stopBackgroundTracking();
          await finishActivity(activity.id);
          setActivity(null);
          setPoints([]);
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
  };

  const onMapPress = (event: any) => {
    if (!planning || activity) return;
    const lngLat = event?.nativeEvent?.lngLat;
    if (!Array.isArray(lngLat) || lngLat.length < 2) return;
    setPlannedPoints((current) => [...current, [Number(lngLat[0]), Number(lngLat[1])]]);
  };

  const undoPlanningPoint = () => {
    setPlannedPoints((current) => current.slice(0, -1));
  };

  const clearPlanning = () => {
    setPlannedPoints([]);
  };

  const savePlannedRoute = async () => {
    if (plannedPoints.length < 2) {
      Alert.alert('Parcours incomplet', 'Ajoute au moins deux points sur la carte.');
      return;
    }

    const route = await saveRoute(sport, plannedPoints);
    Alert.alert('Parcours enregistré', `${route.name}\n${(plannedDistance / 1000).toFixed(2)} km`);
    setPlanning(false);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <Map
        style={styles.map}
        mapStyle={MAP_STYLE}
        logo
        attribution
        compass
        onPress={onMapPress}
      >
        <Camera
          initialViewState={{ center: initialCenter, zoom: 13 }}
          trackUserLocation={activity?.state === 'active' ? 'course' : undefined}
        />
        <UserLocation animated accuracy heading />

        {points.length >= 2 && (
          <GeoJSONSource id="activity-track" data={lineGeoJson}>
            <Layer
              id="activity-line"
              type="line"
              source="activity-track"
              paint={{
                'line-color': '#1565C0',
                'line-width': 5,
                'line-opacity': 0.95,
              }}
            />
          </GeoJSONSource>
        )}

        {planning && plannedPoints.length >= 2 && (
          <GeoJSONSource id="planned-route" data={plannedLineGeoJson}>
            <Layer
              id="planned-route-line"
              type="line"
              source="planned-route"
              paint={{
                'line-color': '#E05B21',
                'line-width': 5,
                'line-opacity': 0.95,
                'line-dasharray': [1.6, 1.1],
              }}
            />
          </GeoJSONSource>
        )}

        {planning && plannedPoints.length > 0 && (
          <GeoJSONSource id="planned-points" data={plannedPointGeoJson}>
            <Layer
              id="planned-points-layer"
              type="circle"
              source="planned-points"
              paint={{
                'circle-radius': 7,
                'circle-color': '#FFFFFF',
                'circle-stroke-color': '#E05B21',
                'circle-stroke-width': 3,
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

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topBar}>
          <View style={styles.sportsRow}>
            {SPORTS.map((item) => (
              <Pressable
                key={item.id}
                disabled={!!activity}
                onPress={() => setSport(item.id)}
                style={[styles.sportChip, sport === item.id && styles.sportChipActive]}
              >
                <Text style={[styles.sportText, sport === item.id && styles.sportTextActive]}>
                  {item.label}
                </Text>
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
              <View>
                <Text style={styles.cardTitle}>Création de parcours</Text>
                <Text style={styles.cardSubTitle}>Touchez la carte pour ajouter des points</Text>
              </View>
              <Pressable onPress={() => setPlanning(false)}>
                <Text style={styles.closePlanner}>Fermer</Text>
              </Pressable>
            </View>

            <View style={styles.plannerSummary}>
              <Text style={styles.plannerDistance}>{(plannedDistance / 1000).toFixed(2)} km</Text>
              <Text style={styles.plannerMeta}>{plannedPoints.length} point{plannedPoints.length > 1 ? 's' : ''} · tracé manuel V1</Text>
            </View>

            <View style={styles.plannerButtons}>
              <Pressable
                onPress={undoPlanningPoint}
                disabled={plannedPoints.length === 0}
                style={[styles.plannerSmallButton, plannedPoints.length === 0 && styles.disabled]}
              >
                <Text style={styles.plannerSmallText}>↶ Annuler</Text>
              </Pressable>
              <Pressable
                onPress={clearPlanning}
                disabled={plannedPoints.length === 0}
                style={[styles.plannerSmallButton, plannedPoints.length === 0 && styles.disabled]}
              >
                <Text style={styles.plannerSmallText}>🗑 Effacer</Text>
              </Pressable>
              <Pressable onPress={savePlannedRoute} style={styles.saveRouteButton}>
                <Text style={styles.saveRouteText}>Enregistrer</Text>
              </Pressable>
            </View>
          </View>
        ) : !activity ? (
          <View style={styles.startWrap}>
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
                  {activity.state === 'paused' ? 'En pause' : 'GPS actif'} · toucher pour {expanded ? 'réduire' : 'agrandir'}
                </Text>
              </View>
              <Text style={styles.chevron}>{expanded ? '⌄' : '⌃'}</Text>
            </Pressable>

            {expanded && stats && (
              <>
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

  startWrap: { padding: 14 },
  startButton: { backgroundColor: '#163F2B', borderRadius: 22, paddingVertical: 16, alignItems: 'center', elevation: 5 },
  startButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },

  plannerCard: { margin: 10, backgroundColor: 'rgba(255,255,255,0.98)', borderRadius: 24, padding: 14, elevation: 8 },
  plannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closePlanner: { color: '#1565C0', fontWeight: '800' },
  plannerSummary: { marginTop: 12, backgroundColor: '#FFF4EE', borderRadius: 16, padding: 12 },
  plannerDistance: { fontSize: 22, fontWeight: '900', color: '#A84418' },
  plannerMeta: { marginTop: 2, color: '#7A6257', fontSize: 12 },
  plannerButtons: { flexDirection: 'row', gap: 8, marginTop: 12 },
  plannerSmallButton: { paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#ECEFED', borderRadius: 14, alignItems: 'center' },
  plannerSmallText: { fontWeight: '800', color: '#36453E' },
  saveRouteButton: { flex: 1, paddingVertical: 12, backgroundColor: '#E05B21', borderRadius: 14, alignItems: 'center' },
  saveRouteText: { color: '#FFFFFF', fontWeight: '900' },

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
