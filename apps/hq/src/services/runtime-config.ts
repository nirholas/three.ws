import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';

export type RuntimeSecretKey =
  | 'GROQ_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'CLOUDFLARE_API_TOKEN'
  | 'ACLED_ACCESS_TOKEN'
  | 'URLHAUS_AUTH_KEY'
  | 'OTX_API_KEY'
  | 'ABUSEIPDB_API_KEY'
  | 'WINGBITS_API_KEY'
  | 'WS_RELAY_URL'
  | 'VITE_OPENSKY_RELAY_URL'
  | 'OPENSKY_CLIENT_ID'
  | 'OPENSKY_CLIENT_SECRET'
  | 'AISSTREAM_API_KEY'
  | 'FINNHUB_API_KEY'
  | 'NASA_FIRMS_API_KEY';

export type RuntimeFeatureId =
  | 'aiGroq'
  | 'aiOpenRouter'
  | 'internetOutages'
  | 'acledConflicts'
  | 'abuseChThreatIntel'
  | 'alienvaultOtxThreatIntel'
  | 'abuseIpdbThreatIntel'
  | 'wingbitsEnrichment'
  | 'aisRelay'
  | 'openskyRelay'
  | 'finnhubMarkets'
  | 'nasaFirms'
  | 'economicFred'
  | 'energyEia';

export interface RuntimeFeatureDefinition {
  id: RuntimeFeatureId;
  name: string;
  description: string;
  requiredSecrets: RuntimeSecretKey[];
  desktopRequiredSecrets?: RuntimeSecretKey[];
  fallback: string;
}

export interface RuntimeSecretState {
  value: string;
  source: 'env' | 'vault';
}

export interface RuntimeConfig {
  featureToggles: Record<RuntimeFeatureId, boolean>;
  secrets: Partial<Record<RuntimeSecretKey, RuntimeSecretState>>;
}

const TOGGLES_STORAGE_KEY = 'hq-runtime-feature-toggles';
const SIDECAR_ENV_UPDATE_URL = 'http://127.0.0.1:46123/api/local-env-update';
const SIDECAR_SECRET_VALIDATE_URL = 'http://127.0.0.1:46123/api/local-validate-secret';

const defaultToggles: Record<RuntimeFeatureId, boolean> = {
  aiGroq: true,
  aiOpenRouter: true,
  internetOutages: true,
  acledConflicts: true,
  abuseChThreatIntel: true,
  alienvaultOtxThreatIntel: true,
  abuseIpdbThreatIntel: true,
  wingbitsEnrichment: true,
  aisRelay: true,
  openskyRelay: true,
  finnhubMarkets: true,
  nasaFirms: true,
  economicFred: true,
  energyEia: true,
};

export const RUNTIME_FEATURES: RuntimeFeatureDefinition[] = [
  {
    id: 'aiGroq',
    name: 'Groq summarization',
    description: 'Primary fast LLM provider used for AI summary generation.',
    requiredSecrets: ['GROQ_API_KEY'],
    fallback: 'Falls back to OpenRouter, then local browser model.',
  },
  {
    id: 'aiOpenRouter',
    name: 'OpenRouter summarization',
    description: 'Secondary LLM provider for AI summary fallback.',
    requiredSecrets: ['OPENROUTER_API_KEY'],
    fallback: 'Falls back to local browser model only.',
  },
  {
    id: 'internetOutages',
    name: 'Cloudflare outage radar',
    description: 'Internet outages from Cloudflare Radar annotations API.',
    requiredSecrets: ['CLOUDFLARE_API_TOKEN'],
    fallback: 'Outage layer is disabled and map continues with other feeds.',
  },
  {
    id: 'acledConflicts',
    name: 'ACLED governance & proposals',
    description: 'Governance and proposal event feeds from ACLED.',
    requiredSecrets: ['ACLED_ACCESS_TOKEN'],
    fallback: 'Governance/proposal overlays are hidden.',
  },
  {
    id: 'abuseChThreatIntel',
    name: 'abuse.ch cyber IOC feeds',
    description: 'URLhaus and ThreatFox IOC ingestion for the cyber threat layer.',
    requiredSecrets: ['URLHAUS_AUTH_KEY'],
    fallback: 'URLhaus/ThreatFox IOC ingestion is disabled.',
  },
  {
    id: 'alienvaultOtxThreatIntel',
    name: 'AlienVault OTX threat intel',
    description: 'Optional OTX IOC ingestion for cyber threat enrichment.',
    requiredSecrets: ['OTX_API_KEY'],
    fallback: 'OTX IOC enrichment is disabled.',
  },
  {
    id: 'abuseIpdbThreatIntel',
    name: 'AbuseIPDB threat intel',
    description: 'Optional AbuseIPDB IOC/reputation enrichment for the cyber threat layer.',
    requiredSecrets: ['ABUSEIPDB_API_KEY'],
    fallback: 'AbuseIPDB enrichment is disabled.',
  },
  {
    id: 'wingbitsEnrichment',
    name: 'Wallet enrichment',
    description: 'Whale wallet identification and enrichment metadata.',
    requiredSecrets: ['WINGBITS_API_KEY'],
    fallback: 'Wallet tracking still renders with heuristic-only classification.',
  },
  {
    id: 'aisRelay',
    name: 'DEX volume tracking',
    description: 'Live DEX volume ingestion via WebSocket.',
    requiredSecrets: ['WS_RELAY_URL', 'AISSTREAM_API_KEY'],
    desktopRequiredSecrets: ['AISSTREAM_API_KEY'],
    fallback: 'Protocol signal layer is disabled.',
  },
  {
    id: 'openskyRelay',
    name: 'On-chain whale tracking',
    description: 'On-chain credentials for whale wallet tracking data.',
    requiredSecrets: ['VITE_OPENSKY_RELAY_URL', 'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
    desktopRequiredSecrets: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
    fallback: 'Whale tracking falls back to limited/no data.',
  },
  {
    id: 'finnhubMarkets',
    name: 'Finnhub market data',
    description: 'Real-time stock quotes and market data from Finnhub.',
    requiredSecrets: ['FINNHUB_API_KEY'],
    fallback: 'Stock ticker uses limited free data.',
  },
  {
    id: 'nasaFirms',
    name: 'NASA FIRMS fire data',
    description: 'Fire Information for Resource Management System satellite data.',
    requiredSecrets: ['NASA_FIRMS_API_KEY'],
    fallback: 'FIRMS fire layer uses public VIIRS feed.',
  },
];

function readEnvSecret(key: RuntimeSecretKey): string {
  const envValue = (import.meta as { env?: Record<string, unknown> }).env?.[key];
  return typeof envValue === 'string' ? envValue.trim() : '';
}

function readStoredToggles(): Record<RuntimeFeatureId, boolean> {
  try {
    const stored = localStorage.getItem(TOGGLES_STORAGE_KEY);
    if (!stored) return { ...defaultToggles };
    const parsed = JSON.parse(stored) as Partial<Record<RuntimeFeatureId, boolean>>;
    return { ...defaultToggles, ...parsed };
  } catch {
    return { ...defaultToggles };
  }
}

const URL_SECRET_KEYS = new Set<RuntimeSecretKey>([
  'WS_RELAY_URL',
  'VITE_OPENSKY_RELAY_URL',
]);

export interface SecretVerificationResult {
  valid: boolean;
  message: string;
}

export function validateSecret(key: RuntimeSecretKey, value: string): { valid: boolean; hint?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, hint: 'Value is required' };

  if (URL_SECRET_KEYS.has(key)) {
    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
        return { valid: false, hint: 'Must be an http(s) or ws(s) URL' };
      }
      return { valid: true };
    } catch {
      return { valid: false, hint: 'Must be a valid URL' };
    }
  }

  return { valid: true };
}

const listeners = new Set<() => void>();

const runtimeConfig: RuntimeConfig = {
  featureToggles: readStoredToggles(),
  secrets: {},
};

let localApiTokenPromise: Promise<string | null> | null = null;

function notifyConfigChanged(): void {
  for (const listener of listeners) listener();
}

function seedSecretsFromEnvironment(): void {
  if (isDesktopRuntime()) return;

  const keys = new Set<RuntimeSecretKey>(RUNTIME_FEATURES.flatMap(feature => feature.requiredSecrets));
  for (const key of keys) {
    const value = readEnvSecret(key);
    if (value) {
      runtimeConfig.secrets[key] = { value, source: 'env' };
    }
  }
}

seedSecretsFromEnvironment();

// Listen for cross-window state updates (settings ↔ main).
// When one window saves secrets or toggles features, the `storage` event fires in other same-origin windows.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'wm-secrets-updated') {
      void loadDesktopSecrets();
    } else if (e.key === TOGGLES_STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue) as Partial<Record<RuntimeFeatureId, boolean>>;
        Object.assign(runtimeConfig.featureToggles, parsed);
        notifyConfigChanged();
      } catch { /* ignore malformed JSON */ }
    }
  });
}

export function subscribeRuntimeConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRuntimeConfigSnapshot(): RuntimeConfig {
  return {
    featureToggles: { ...runtimeConfig.featureToggles },
    secrets: { ...runtimeConfig.secrets },
  };
}

export function isFeatureEnabled(featureId: RuntimeFeatureId): boolean {
  return runtimeConfig.featureToggles[featureId] !== false;
}

export function getSecretState(key: RuntimeSecretKey): { present: boolean; valid: boolean; source: 'env' | 'vault' | 'missing' } {
  const state = runtimeConfig.secrets[key];
  if (!state) return { present: false, valid: false, source: 'missing' };
  return { present: true, valid: validateSecret(key, state.value).valid, source: state.source };
}

export function isFeatureAvailable(featureId: RuntimeFeatureId): boolean {
  if (!isFeatureEnabled(featureId)) return false;

  // Cloud/web deployments validate credentials server-side.
  // Desktop runtime validates local secrets client-side for capability gating.
  if (!isDesktopRuntime()) {
    return true;
  }

  const feature = RUNTIME_FEATURES.find(item => item.id === featureId);
  if (!feature) return false;
  const secrets = feature.desktopRequiredSecrets ?? feature.requiredSecrets;
  return secrets.every(secretKey => getSecretState(secretKey).valid);
}

export function getEffectiveSecrets(feature: RuntimeFeatureDefinition): RuntimeSecretKey[] {
  return (isDesktopRuntime() && feature.desktopRequiredSecrets) ? feature.desktopRequiredSecrets : feature.requiredSecrets;
}

export function setFeatureToggle(featureId: RuntimeFeatureId, enabled: boolean): void {
  runtimeConfig.featureToggles[featureId] = enabled;
  localStorage.setItem(TOGGLES_STORAGE_KEY, JSON.stringify(runtimeConfig.featureToggles));
  notifyConfigChanged();
}

export async function setSecretValue(key: RuntimeSecretKey, value: string): Promise<void> {
  if (!isDesktopRuntime()) {
    console.warn('[runtime-config] Ignoring secret write outside desktop runtime');
    return;
  }

  const sanitized = value.trim();
  if (sanitized) {
    await invokeTauri<void>('set_secret', { key, value: sanitized });
    runtimeConfig.secrets[key] = { value: sanitized, source: 'vault' };
  } else {
    await invokeTauri<void>('delete_secret', { key });
    delete runtimeConfig.secrets[key];
  }

  // Push to sidecar so handlers pick it up immediately.
  // This is best-effort: keyring persistence is the source of truth.
  try {
    await pushSecretToSidecar(key, sanitized || '');
  } catch (error) {
    console.warn(`[runtime-config] Failed to sync ${key} to sidecar`, error);
  }

  // Signal other windows (main ↔ settings) to reload secrets from keychain.
  // The `storage` event fires in all same-origin windows except the one that wrote.
  try {
    localStorage.setItem('wm-secrets-updated', String(Date.now()));
  } catch { /* localStorage may be unavailable */ }

  notifyConfigChanged();
}

async function getLocalApiToken(): Promise<string | null> {
  if (!localApiTokenPromise) {
    localApiTokenPromise = invokeTauri<string>('get_local_api_token')
      .then((token) => token.trim() || null)
      .catch((error) => {
        // Allow retries on subsequent calls if bridge/token is temporarily unavailable.
        localApiTokenPromise = null;
        throw error;
      });
  }
  return localApiTokenPromise;
}

async function pushSecretToSidecar(key: string, value: string): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = await getLocalApiToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(SIDECAR_ENV_UPDATE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key, value: value || null }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch { /* ignore non-readable body */ }
    throw new Error(`Sidecar secret sync failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
}

async function callSidecarWithAuth(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = await getLocalApiToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

export async function verifySecretWithApi(
  key: RuntimeSecretKey,
  value: string,
  context: Partial<Record<RuntimeSecretKey, string>> = {},
): Promise<SecretVerificationResult> {
  const localValidation = validateSecret(key, value);
  if (!localValidation.valid) {
    return { valid: false, message: localValidation.hint || 'Invalid value' };
  }

  if (!isDesktopRuntime()) {
    return { valid: true, message: 'Saved' };
  }

  try {
    const response = await callSidecarWithAuth(SIDECAR_SECRET_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: value.trim(), context }),
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch { /* non-JSON response */ }

    if (!response.ok) {
      const message = payload && typeof payload === 'object'
        ? String(
            (payload as Record<string, unknown>).message
            || (payload as Record<string, unknown>).error
            || 'Secret validation failed'
          )
        : `Secret validation failed (${response.status})`;
      return { valid: false, message };
    }

    if (!payload || typeof payload !== 'object') {
      return { valid: false, message: 'Secret validation returned an invalid response' };
    }

    const valid = Boolean((payload as Record<string, unknown>).valid);
    const message = String((payload as Record<string, unknown>).message || (valid ? 'Verified' : 'Verification failed'));
    return { valid, message };
  } catch (error) {
    // Network errors reaching the sidecar should NOT block saving.
    // Only explicit 401/403 from the provider means the key is invalid.
    const message = error instanceof Error ? error.message : 'Secret validation failed';
    return { valid: true, message: `Saved (could not verify - ${message})` };
  }
}

export async function loadDesktopSecrets(): Promise<void> {
  if (!isDesktopRuntime()) return;

  try {
    const keys = await invokeTauri<RuntimeSecretKey[]>('list_supported_secret_keys');

    const results = await Promise.allSettled(keys.map(async (key) => {
      const value = await invokeTauri<string | null>('get_secret', { key });
      if (value && value.trim()) {
        runtimeConfig.secrets[key] = { value: value.trim(), source: 'vault' };
        try {
          await pushSecretToSidecar(key, value.trim());
        } catch (error) {
          console.warn(`[runtime-config] Failed to sync ${key} to sidecar`, error);
        }
      }
    }));

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[runtime-config] ${failures.length} key(s) failed to load from vault`);
    }

    notifyConfigChanged();
  } catch (error) {
    console.warn('[runtime-config] Failed to load desktop secrets from vault', error);
  }
}
