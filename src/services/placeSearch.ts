export interface PlaceSearchResult {
  id: string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  type?: string;
}

export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '8',
    'accept-language': 'fr',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Visomoot/0.6 personal outdoor app',
    },
  });

  if (!response.ok) {
    throw new Error(`Recherche de lieu indisponible (${response.status}).`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) return [];

  return data
    .map((item: any) => {
      const latitude = Number(item?.lat);
      const longitude = Number(item?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      const address = item?.address ?? {};
      const name =
        item?.name ||
        address.city ||
        address.town ||
        address.village ||
        address.hamlet ||
        String(item?.display_name || '').split(',')[0] ||
        q;

      return {
        id: String(item?.place_id ?? `${latitude}-${longitude}`),
        name: String(name),
        displayName: String(item?.display_name ?? name),
        latitude,
        longitude,
        type: item?.type ? String(item.type) : undefined,
      } as PlaceSearchResult;
    })
    .filter(Boolean) as PlaceSearchResult[];
}
