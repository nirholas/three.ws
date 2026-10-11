import type { Hotspot, TrendDirection, TrackedFlight, TrackedVessel } from '@/types';
import { FOCUS_AREAS } from '@/config/geo';
import { haversineKm } from '@/utils/geo';

export interface DynamicEscalationScore {
  hotspotId: string;
  staticBaseline: number;
  dynamicScore: number;
  combinedScore: number;
  trend: TrendDirection;
  components: {
    newsActivity: number;
    riskContribution: number;
    geoConvergence: number;
    whaleActivity: number;
  };
  history: Array<{ timestamp: number; score: number }>;
  lastUpdated: Date;
}

interface EscalationInputs {
  newsMatches: number;
  hasBreaking: boolean;
  newsVelocity: number;
  riskScore: number | null;
  /** @deprecated Use riskScore */
  ciiScore?: number | null;
  geoAlertScore: number;
  geoAlertTypes: number;
  flightsNearby: number;
  vesselsNearby: number;
}

const HOTSPOT_COUNTRY_MAP: Record<string, string | string[] | null> = {
  tehran: 'IR',
  moscow: 'RU',
  beijing: 'CN',
  kyiv: 'UA',
  taipei: 'TW',
  telaviv: 'IL',
  pyongyang: 'KP',
  sanaa: 'YE',
  sahel: ['ML', 'NE', 'BF'],
  haiti: 'HT',
  horn_africa: ['ET', 'SO', 'SD'],
  silicon_valley: 'US',
  wall_street: 'US',
  houston: 'US',
  dc: 'US',
  cairo: 'EG',
  doha: 'QA',
  beirut: 'LB',
  riyadh: 'SA',
  ankara: 'TR',
  damascus: 'SY',
  caracas: 'VE',
};

const COMPONENT_WEIGHTS = {
  news: 0.35,
  risk: 0.25,
  geo: 0.25,
  whale: 0.15,
};

const scores = new Map<string, DynamicEscalationScore>();
const lastSignalTime = new Map<string, number>();
const SIGNAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_POINTS = 48;

let riskGetter: ((code: string) => number | null) | null = null;
let geoAlertGetter: ((lat: number, lon: number, radiusKm: number) => { score: number; types: number } | null) | null = null;

export function setRiskGetter(fn: (code: string) => number | null): void {
  riskGetter = fn;
}
export function setGeoAlertGetter(fn: (lat: number, lon: number, radiusKm: number) => { score: number; types: number } | null): void {
  geoAlertGetter = fn;
}

function getStaticBaseline(hotspot: Hotspot): number {
  return hotspot.trendScore ?? hotspot.escalationScore ?? 3;
}

function getRiskForHotspot(hotspotId: string): number | null {
  if (!riskGetter) return null;

  const mapping = HOTSPOT_COUNTRY_MAP[hotspotId];
  if (!mapping) return null;

  if (Array.isArray(mapping)) {
    const scores = mapping.map(code => riskGetter!(code)).filter((s): s is number => s !== null);
    return scores.length > 0 ? Math.max(...scores) : null;
  }

  return riskGetter(mapping);
}
function getGeoAlertForHotspot(hotspot: Hotspot): { score: number; types: number } | null {
  if (!geoAlertGetter) return null;
  return geoAlertGetter(hotspot.lat, hotspot.lon, 150);
}

function normalizeNewsActivity(matches: number, hasBreaking: boolean, velocity: number): number {
  return Math.min(100, matches * 15 + (hasBreaking ? 30 : 0) + velocity * 5);
}

function normalizeRisk(score: number | null): number {
  return score ?? 30;
}

function normalizeGeo(alertScore: number, alertTypes: number): number {
  if (alertScore === 0) return 0;
  return Math.min(100, alertScore + alertTypes * 10);
}

function normalizeWhaleActivity(flights: number, vessels: number): number {
  return Math.min(100, flights * 10 + vessels * 15);
}

function calculateDynamicRaw(components: DynamicEscalationScore['components']): number {
  return (
    components.newsActivity * COMPONENT_WEIGHTS.news +
    components.riskContribution * COMPONENT_WEIGHTS.risk +
    components.geoConvergence * COMPONENT_WEIGHTS.geo +
    components.whaleActivity * COMPONENT_WEIGHTS.whale
  );
}

function rawToScore(raw: number): number {
  return 1 + (raw / 100) * 4;
}

function blendScores(staticBaseline: number, dynamicScore: number): number {
  return staticBaseline * 0.3 + dynamicScore * 0.7;
}

function pruneHistory(history: Array<{ timestamp: number; score: number }>): Array<{ timestamp: number; score: number }> {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  const pruned = history.filter(h => h.timestamp >= cutoff);
  if (pruned.length > MAX_HISTORY_POINTS) {
    return pruned.slice(-MAX_HISTORY_POINTS);
  }
  return pruned;
}

function detectTrend(history: Array<{ timestamp: number; score: number }>): TrendDirection {
  if (history.length < 3) return 'stable';

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  let validCount = 0;

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (!entry) continue;
    sumX += validCount;
    sumY += entry.score;
    sumXY += validCount * entry.score;
    sumX2 += validCount * validCount;
    validCount++;
  }

  if (validCount < 3) return 'stable';

  const denominator = validCount * sumX2 - sumX * sumX;
  if (denominator === 0) return 'stable';

  const slope = (validCount * sumXY - sumX * sumY) / denominator;

  if (slope > 0.1) return 'escalating';
  if (slope < -0.1) return 'de-escalating';
  return 'stable';
}

export function calculateDynamicScore(
  hotspotId: string,
  inputs: EscalationInputs
): DynamicEscalationScore {
  const hotspot = FOCUS_AREAS.find(h => h.id === hotspotId);
  if (!hotspot) {
    throw new Error(`Focus area not found: ${hotspotId}`);
  }

  const staticBaseline = getStaticBaseline(hotspot);
  const existing = scores.get(hotspotId);
  const now = Date.now();

  const components = {
    newsActivity: normalizeNewsActivity(inputs.newsMatches, inputs.hasBreaking, inputs.newsVelocity),
    riskContribution: normalizeRisk(inputs.riskScore ?? inputs.ciiScore ?? null),
    geoConvergence: normalizeGeo(inputs.geoAlertScore, inputs.geoAlertTypes),
    whaleActivity: normalizeWhaleActivity(inputs.flightsNearby, inputs.vesselsNearby),
  };

  const dynamicRaw = calculateDynamicRaw(components);
  const dynamicScore = rawToScore(dynamicRaw);
  const combinedScore = blendScores(staticBaseline, dynamicScore);

  let history = existing?.history ?? [];
  history = pruneHistory(history);
  history.push({ timestamp: now, score: combinedScore });

  const trend = detectTrend(history);

  const result: DynamicEscalationScore = {
    hotspotId,
    staticBaseline,
    dynamicScore: Math.round(dynamicScore * 10) / 10,
    combinedScore: Math.round(combinedScore * 10) / 10,
    trend,
    components,
    history,
    lastUpdated: new Date(),
  };

  scores.set(hotspotId, result);
  return result;
}

export function getHotspotEscalation(hotspotId: string): DynamicEscalationScore | null {
  return scores.get(hotspotId) ?? null;
}

export function getAllEscalationScores(): DynamicEscalationScore[] {
  return Array.from(scores.values());
}

export interface EscalationSignalReason {
  type: 'threshold_crossed' | 'rapid_increase' | 'critical_reached';
  oldScore: number;
  newScore: number;
  threshold?: number;
}

export function shouldEmitSignal(hotspotId: string, oldScore: number | null, newScore: number): EscalationSignalReason | null {
  const lastSignal = lastSignalTime.get(hotspotId) ?? 0;
  if (Date.now() - lastSignal < SIGNAL_COOLDOWN_MS) return null;

  if (oldScore === null) return null;

  const oldInt = Math.floor(oldScore);
  const newInt = Math.floor(newScore);
  if (newInt > oldInt && newScore >= 2) {
    return { type: 'threshold_crossed', oldScore, newScore, threshold: newInt };
  }

  if (newScore - oldScore >= 0.5) {
    return { type: 'rapid_increase', oldScore, newScore };
  }

  if (newScore >= 4.5 && oldScore < 4.5) {
    return { type: 'critical_reached', oldScore, newScore };
  }

  return null;
}

export function markSignalEmitted(hotspotId: string): void {
  lastSignalTime.set(hotspotId, Date.now());
}

export function countActivityNearHotspot(
  hotspot: Hotspot,
  flights: TrackedFlight[],
  vessels: TrackedVessel[],
  radiusKm: number = 200
): { flights: number; vessels: number } {

  let flightCount = 0;
  let vesselCount = 0;

  for (const f of flights) {
    if (haversineKm(hotspot.lat, hotspot.lon, f.lat, f.lon) <= radiusKm) {
      flightCount++;
    }
  }

  for (const v of vessels) {
    if (haversineKm(hotspot.lat, hotspot.lon, v.lat, v.lon) <= radiusKm) {
      vesselCount++;
    }
  }

  return { flights: flightCount, vessels: vesselCount };
}

let activityData: { flights: TrackedFlight[]; vessels: TrackedVessel[] } = { flights: [], vessels: [] };

export function setActivityData(flights: TrackedFlight[], vessels: TrackedVessel[]): void {
  activityData = { flights, vessels };
}
export function updateHotspotEscalation(
  hotspotId: string,
  newsMatches: number,
  hasBreaking: boolean,
  newsVelocity: number
): DynamicEscalationScore | null {
  const hotspot = FOCUS_AREAS.find(h => h.id === hotspotId);
  if (!hotspot) return null;

  const riskScore = getRiskForHotspot(hotspotId);
  const geoAlert = getGeoAlertForHotspot(hotspot);
  const activity = countActivityNearHotspot(hotspot, activityData.flights, activityData.vessels);

  const inputs: EscalationInputs = {
    newsMatches,
    hasBreaking,
    newsVelocity,
    riskScore,
    geoAlertScore: geoAlert?.score ?? 0,
    geoAlertTypes: geoAlert?.types ?? 0,
    flightsNearby: activity.flights,
    vesselsNearby: activity.vessels,
  };

  return calculateDynamicScore(hotspotId, inputs);
}

export function getEscalationChange24h(hotspotId: string): { change: number; start: number; end: number } | null {
  const score = scores.get(hotspotId);
  if (!score || score.history.length < 2) return null;

  const now = Date.now();
  const h24Ago = now - HISTORY_WINDOW_MS;

  const oldestInWindow = score.history.find(h => h.timestamp >= h24Ago);
  const newest = score.history[score.history.length - 1];

  if (!oldestInWindow || !newest) return null;

  return {
    change: Math.round((newest.score - oldestInWindow.score) * 10) / 10,
    start: Math.round(oldestInWindow.score * 10) / 10,
    end: Math.round(newest.score * 10) / 10,
  };
}

export function clearEscalationData(): void {
  scores.clear();
  lastSignalTime.clear();
}
