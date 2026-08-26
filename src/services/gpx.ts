import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { TrackPoint } from '../types/domain';

export interface ImportedGpxPoint {
  longitude: number;
  latitude: number;
  elevation: number | null;
  timestamp: number | null;
}

export interface ImportedGpx {
  name: string;
  fileName: string;
  points: ImportedGpxPoint[];
  coordinates: Array<[number, number]>;
  distanceM: number;
  ascentM: number;
  descentM: number;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function safeFileName(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return normalized || 'visomoot';
}

function gpxHeader(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Visomoot" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n  <metadata><name>${escapeXml(name)}</name></metadata>`;
}

export function gpxFromCoordinates(name: string, coordinates: Array<[number, number]>) {
  const segment = coordinates
    .map(([longitude, latitude]) => `      <trkpt lat="${latitude.toFixed(7)}" lon="${longitude.toFixed(7)}"></trkpt>`)
    .join('\n');

  return `${gpxHeader(name)}\n  <trk><name>${escapeXml(name)}</name><trkseg>\n${segment}\n    </trkseg></trk>\n</gpx>\n`;
}

export function gpxFromTrackPoints(name: string, points: TrackPoint[]) {
  const segment = points
    .map((point) => {
      const ele = point.altitude == null ? '' : `<ele>${point.altitude.toFixed(1)}</ele>`;
      const time = point.timestamp ? `<time>${new Date(point.timestamp).toISOString()}</time>` : '';
      return `      <trkpt lat="${point.latitude.toFixed(7)}" lon="${point.longitude.toFixed(7)}">${ele}${time}</trkpt>`;
    })
    .join('\n');

  return `${gpxHeader(name)}\n  <trk><name>${escapeXml(name)}</name><trkseg>\n${segment}\n    </trkseg></trk>\n</gpx>\n`;
}

export async function shareGpx(name: string, xml: string) {
  if (!FileSystem.cacheDirectory) throw new Error('Répertoire temporaire indisponible.');

  const fileName = `${safeFileName(name)}.gpx`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, xml, { encoding: FileSystem.EncodingType.UTF8 });

  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("Le partage de fichier n'est pas disponible sur cet appareil.");

  await Sharing.shareAsync(uri, {
    dialogTitle: 'Enregistrer ou partager le GPX',
    mimeType: 'application/gpx+xml',
    UTI: 'com.topografix.gpx',
  });
}

function attrValue(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] ?? null;
}

function firstTagText(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '')) : null;
}

function parsePointTags(xml: string, tag: 'trkpt' | 'rtept' | 'wpt'): ImportedGpxPoint[] {
  const points: ImportedGpxPoint[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${tag}\\s*>)`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml)) !== null) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const lat = Number(attrValue(attributes, 'lat'));
    const lon = Number(attrValue(attributes, 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    const elevationText = firstTagText(body, 'ele');
    const elevationNumber = elevationText == null ? NaN : Number(elevationText);
    const timeText = firstTagText(body, 'time');
    const timeNumber = timeText ? Date.parse(timeText) : NaN;

    points.push({
      longitude: lon,
      latitude: lat,
      elevation: Number.isFinite(elevationNumber) ? elevationNumber : null,
      timestamp: Number.isFinite(timeNumber) ? timeNumber : null,
    });
  }

  return points;
}

function distanceMeters(a: ImportedGpxPoint, b: ImportedGpxPoint) {
  const R = 6371000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function importedStats(points: ImportedGpxPoint[]) {
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const step = distanceMeters(previous, current);
    if (Number.isFinite(step) && step < 10000) distanceM += step;

    if (previous.elevation != null && current.elevation != null) {
      const delta = current.elevation - previous.elevation;
      if (Math.abs(delta) < 100) {
        if (delta > 0) ascentM += delta;
        else descentM += Math.abs(delta);
      }
    }
  }

  return { distanceM, ascentM, descentM };
}

export function parseGpx(xml: string, fileName = 'parcours.gpx'): ImportedGpx {
  const clean = xml.replace(/^\uFEFF/, '').trim();
  if (!/<gpx\b/i.test(clean)) throw new Error("Ce fichier ne semble pas être un fichier GPX valide.");

  let points = parsePointTags(clean, 'trkpt');
  if (points.length < 2) points = parsePointTags(clean, 'rtept');
  if (points.length < 2) points = parsePointTags(clean, 'wpt');
  if (points.length < 2) throw new Error('Le GPX ne contient pas assez de points pour créer un parcours.');

  const metadataMatch = clean.match(/<metadata\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/metadata>/i);
  const trackMatch = clean.match(/<(?:trk|rte)\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i);
  const rawName = metadataMatch?.[1] ?? trackMatch?.[1] ?? fileName.replace(/\.gpx$/i, '');
  const name = decodeXml(rawName.replace(/<[^>]+>/g, '')) || fileName.replace(/\.gpx$/i, '') || 'Parcours GPX';
  const coordinates = points.map((point) => [point.longitude, point.latitude] as [number, number]);
  const stats = importedStats(points);

  return {
    name,
    fileName,
    points,
    coordinates,
    ...stats,
  };
}

export async function pickAndReadGpx(): Promise<ImportedGpx | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  if (!asset.name.toLowerCase().endsWith('.gpx')) {
    throw new Error('Sélectionne un fichier avec l’extension .gpx.');
  }

  const xml = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
  return parseGpx(xml, asset.name);
}
