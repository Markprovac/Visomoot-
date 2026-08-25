export interface RadarFrame {
  time: number;
  tileUrl: string;
}

export async function getLatestRadarFrame(): Promise<RadarFrame | null> {
  const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!response.ok) throw new Error('Radar indisponible');

  const json = await response.json();
  const frames = json?.radar?.past;
  if (!Array.isArray(frames) || frames.length === 0) return null;

  const latest = frames[frames.length - 1];
  return {
    time: latest.time,
    tileUrl: `${json.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`,
  };
}
