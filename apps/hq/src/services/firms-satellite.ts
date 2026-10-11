// NASA FIRMS Satellite Fire Data Service
// Fetches active fire detections via /api/firms-fires edge function
// Detects thermal anomalies in monitored conflict regions

export interface FireDataPoint {
  lat: number;
  lon: number;
  brightness: number;  // Kelvin (bright_ti4)
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: number;  // 0-100
  bright_t31: number;
  frp: number;  // Fire Radiative Power (MW)
  daynight: string;  // "D" or "N"
}

export interface FireRegionStats {
  region: string;
  fires: FireDataPoint[];
  fireCount: number;
  totalFrp: number;  // MW
  highIntensityCount: number;
}

const FIRMS_API = '/api/firms-fires';

// Fetch fires for all monitored regions
export async function fetchAllFires(days: number = 1): Promise<{
  regions: Record<string, FireDataPoint[]>;
  totalCount: number;
}> {
  try {
    const res = await fetch(`${FIRMS_API}?days=${days}`);
    if (!res.ok) {
      console.warn(`[FIRMS] API returned ${res.status}`);
      return { regions: {}, totalCount: 0 };
    }
    const data = await res.json();
    return { regions: data.regions || {}, totalCount: data.totalCount || 0 };
  } catch (e) {
    console.warn('[FIRMS] Fetch failed:', e);
    return { regions: {}, totalCount: 0 };
  }
}

// Fetch fires for a single region
export async function fetchFiresForRegion(region: string, days: number = 1): Promise<FireDataPoint[]> {
  try {
    const res = await fetch(`${FIRMS_API}?region=${encodeURIComponent(region)}&days=${days}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.regions?.[region] || [];
  } catch (e) {
    console.warn(`[FIRMS] Fetch failed for ${region}:`, e);
    return [];
  }
}

// Get stats for all regions
export function computeRegionStats(regions: Record<string, FireDataPoint[]>): FireRegionStats[] {
  const stats: FireRegionStats[] = [];

  for (const [region, fires] of Object.entries(regions)) {
    const highIntensity = fires.filter(f => f.brightness > 360 && f.confidence > 80);
    stats.push({
      region,
      fires,
      fireCount: fires.length,
      totalFrp: fires.reduce((sum, f) => sum + (f.frp || 0), 0),
      highIntensityCount: highIntensity.length,
    });
  }

  return stats.sort((a, b) => b.fireCount - a.fireCount);
}

// Flatten all regions into a single array with region tag
export function flattenFires(regions: Record<string, FireDataPoint[]>): Array<FireDataPoint & { region: string }> {
  const all: Array<FireDataPoint & { region: string }> = [];
  for (const [region, fires] of Object.entries(regions)) {
    for (const f of fires) {
      all.push({ ...f, region });
    }
  }
  return all;
}
