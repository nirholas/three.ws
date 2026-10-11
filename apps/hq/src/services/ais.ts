import type { AisDisruptionEvent, AisDensityZone } from '@/types';
import { dataFreshness } from './data-freshness';
import { isFeatureAvailable } from './runtime-config';

const wsRelayUrl = import.meta.env.VITE_WS_RELAY_URL || '';
const RAILWAY_SNAPSHOT_URL = wsRelayUrl
  ? wsRelayUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '') + '/ais/snapshot'
  : '';
const VERCEL_SNAPSHOT_API = '/api/ais-snapshot';
const LOCAL_SNAPSHOT_FALLBACK = 'http://localhost:3004/ais/snapshot';
const SNAPSHOT_POLL_INTERVAL_MS = 10 * 1000;
const SNAPSHOT_STALE_MS = 20 * 1000;
const CALLBACK_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_CALLBACK_TRACKED_VESSELS = 20000;

const isClientRuntime = typeof window !== 'undefined';
const isLocalhost = isClientRuntime && window.location.hostname === 'localhost';
// Snapshot polling no longer requires exposing relay URL to the browser.
// Use VITE_ENABLE_AIS=false to disable the AIS feature client-side.
const aisConfigured = isClientRuntime && import.meta.env.VITE_ENABLE_AIS !== 'false';

export function isAisConfigured(): boolean {
  return aisConfigured && isFeatureAvailable('aisRelay');
}

export interface AisPositionData {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  shipType?: number;
  heading?: number;
  speed?: number;
  course?: number;
}

interface SnapshotStatus {
  connected: boolean;
  vessels: number;
  messages: number;
}

interface SnapshotCandidateReport extends AisPositionData {
  timestamp: number;
}

interface AisSnapshotResponse {
  sequence?: number;
  timestamp?: string;
  status?: {
    connected?: boolean;
    vessels?: number;
    messages?: number;
  };
  disruptions?: AisDisruptionEvent[];
  density?: AisDensityZone[];
  candidateReports?: SnapshotCandidateReport[];
}

type AisCallback = (data: AisPositionData) => void;
const positionCallbacks = new Set<AisCallback>();
const lastCallbackTimestampByMmsi = new Map<string, number>();

let pollInterval: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let isPolling = false;
let lastPollAt = 0;
let lastSequence = 0;

let latestDisruptions: AisDisruptionEvent[] = [];
let latestDensity: AisDensityZone[] = [];
let latestStatus: SnapshotStatus = {
  connected: false,
  vessels: 0,
  messages: 0,
};

function shouldIncludeCandidates(): boolean {
  return positionCallbacks.size > 0;
}

function parseSnapshot(data: unknown): {
  sequence: number;
  status: SnapshotStatus;
  disruptions: AisDisruptionEvent[];
  density: AisDensityZone[];
  candidateReports: SnapshotCandidateReport[];
} | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as AisSnapshotResponse;

  if (!Array.isArray(raw.disruptions) || !Array.isArray(raw.density)) return null;

  const status = raw.status || {};
  return {
    sequence: Number.isFinite(raw.sequence as number) ? Number(raw.sequence) : 0,
    status: {
      connected: Boolean(status.connected),
      vessels: Number.isFinite(status.vessels as number) ? Number(status.vessels) : 0,
      messages: Number.isFinite(status.messages as number) ? Number(status.messages) : 0,
    },
    disruptions: raw.disruptions,
    density: raw.density,
    candidateReports: Array.isArray(raw.candidateReports) ? raw.candidateReports : [],
  };
}

async function fetchSnapshotPayload(includeCandidates: boolean): Promise<unknown> {
  const query = `?candidates=${includeCandidates ? 'true' : 'false'}`;

  if (RAILWAY_SNAPSHOT_URL) {
    try {
      const railway = await fetch(`${RAILWAY_SNAPSHOT_URL}${query}`, { headers: { Accept: 'application/json' } });
      if (railway.ok) return railway.json();
    } catch { /* Railway unavailable - fall through */ }
  }

  const primary = await fetch(`${VERCEL_SNAPSHOT_API}${query}`, { headers: { Accept: 'application/json' } });
  if (primary.ok) return primary.json();

  if (isLocalhost) {
    const local = await fetch(`${LOCAL_SNAPSHOT_FALLBACK}${query}`, { headers: { Accept: 'application/json' } });
    if (local.ok) return local.json();
  }

  throw new Error(`AIS snapshot HTTP ${primary.status}`);
}

function pruneCallbackTimestampIndex(now: number): void {
  if (lastCallbackTimestampByMmsi.size <= MAX_CALLBACK_TRACKED_VESSELS) {
    return;
  }

  const threshold = now - CALLBACK_RETENTION_MS;
  for (const [mmsi, ts] of lastCallbackTimestampByMmsi) {
    if (ts < threshold) {
      lastCallbackTimestampByMmsi.delete(mmsi);
    }
  }

  if (lastCallbackTimestampByMmsi.size <= MAX_CALLBACK_TRACKED_VESSELS) {
    return;
  }

  const oldest = Array.from(lastCallbackTimestampByMmsi.entries())
    .sort((a, b) => a[1] - b[1]);
  const toDelete = lastCallbackTimestampByMmsi.size - MAX_CALLBACK_TRACKED_VESSELS;
  for (let i = 0; i < toDelete; i++) {
    const entry = oldest[i];
    if (!entry) break;
    lastCallbackTimestampByMmsi.delete(entry[0]);
  }
}

function emitCandidateReports(reports: SnapshotCandidateReport[]): void {
  if (positionCallbacks.size === 0 || reports.length === 0) return;
  const now = Date.now();

  for (const report of reports) {
    if (!report?.mmsi || !Number.isFinite(report.lat) || !Number.isFinite(report.lon)) continue;

    const reportTs = Number.isFinite(report.timestamp) ? Number(report.timestamp) : now;
    const lastTs = lastCallbackTimestampByMmsi.get(report.mmsi) || 0;
    if (reportTs <= lastTs) continue;

    lastCallbackTimestampByMmsi.set(report.mmsi, reportTs);
    const callbackData: AisPositionData = {
      mmsi: report.mmsi,
      name: report.name || '',
      lat: report.lat,
      lon: report.lon,
      shipType: report.shipType,
      heading: report.heading,
      speed: report.speed,
      course: report.course,
    };

    for (const callback of positionCallbacks) {
      try {
        callback(callbackData);
      } catch {
        // Ignore callback errors
      }
    }
  }

  pruneCallbackTimestampIndex(now);
}

async function pollSnapshot(force = false): Promise<void> {
  if (!isAisConfigured()) return;
  if (inFlight && !force) return;

  inFlight = true;
  try {
    const includeCandidates = shouldIncludeCandidates();
    const payload = await fetchSnapshotPayload(includeCandidates);
    const snapshot = parseSnapshot(payload);
    if (!snapshot) throw new Error('Invalid snapshot payload');

    latestDisruptions = snapshot.disruptions;
    latestDensity = snapshot.density;
    latestStatus = snapshot.status;
    lastPollAt = Date.now();

    if (includeCandidates) {
      if (snapshot.sequence > lastSequence) {
        emitCandidateReports(snapshot.candidateReports);
        lastSequence = snapshot.sequence;
      } else if (lastSequence === 0) {
        emitCandidateReports(snapshot.candidateReports);
        lastSequence = snapshot.sequence;
      }
    } else {
      lastSequence = snapshot.sequence;
    }

    const itemCount = latestDisruptions.length + latestDensity.length;
    if (itemCount > 0 || latestStatus.vessels > 0) {
      dataFreshness.recordUpdate('ais', itemCount > 0 ? itemCount : latestStatus.vessels);
    }
  } catch {
    latestStatus.connected = false;
  } finally {
    inFlight = false;
  }
}

function startPolling(): void {
  if (isPolling || !isAisConfigured()) return;
  isPolling = true;
  void pollSnapshot(true);
  pollInterval = setInterval(() => {
    void pollSnapshot(false);
  }, SNAPSHOT_POLL_INTERVAL_MS);
}

export function registerAisCallback(callback: AisCallback): void {
  positionCallbacks.add(callback);
  startPolling();
}

export function unregisterAisCallback(callback: AisCallback): void {
  positionCallbacks.delete(callback);
  if (positionCallbacks.size === 0) {
    lastCallbackTimestampByMmsi.clear();
  }
}

export function initAisStream(): void {
  startPolling();
}

export function disconnectAisStream(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  isPolling = false;
  inFlight = false;
  latestStatus.connected = false;
}

export function getAisStatus(): { connected: boolean; vessels: number; messages: number } {
  const isFresh = Date.now() - lastPollAt <= SNAPSHOT_STALE_MS;
  return {
    connected: latestStatus.connected && isFresh,
    vessels: latestStatus.vessels,
    messages: latestStatus.messages,
  };
}

export async function fetchAisSignals(): Promise<{ disruptions: AisDisruptionEvent[]; density: AisDensityZone[] }> {
  if (!aisConfigured) {
    return { disruptions: [], density: [] };
  }

  startPolling();
  const shouldRefresh = Date.now() - lastPollAt > SNAPSHOT_STALE_MS;
  if (shouldRefresh) {
    await pollSnapshot(true);
  }

  return {
    disruptions: latestDisruptions,
    density: latestDensity,
  };
}
