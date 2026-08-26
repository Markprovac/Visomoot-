export interface RadarFrame {
  time: number;
  tileUrl: string;
}

export async function getRadarFrames(): Promise<RadarFrame[]> {
  const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!response.ok) throw new Error('Radar indisponible');

  const json = await response.json();
  const frames = json?.radar?.past;
  if (!Array.isArray(frames) || frames.length === 0) return [];

  return frames
    .filter((frame: any) => Number.isFinite(Number(frame?.time)) && typeof frame?.path === 'string')
    .map((frame: any) => ({
      time: Number(frame.time),
      tileUrl: `${json.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
    }));
}

export async function getLatestRadarFrame(): Promise<RadarFrame | null> {
  const frames = await getRadarFrames();
  return frames.length ? frames[frames.length - 1] : null;
}
