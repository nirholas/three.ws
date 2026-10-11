import { Panel } from './Panel';
import {
  RUNTIME_FEATURES,
  getEffectiveSecrets,
  getRuntimeConfigSnapshot,
  getSecretState,
  isFeatureAvailable,
  isFeatureEnabled,
  setFeatureToggle,
  setSecretValue,
  subscribeRuntimeConfig,
  validateSecret,
  verifySecretWithApi,
  type RuntimeFeatureDefinition,
  type RuntimeSecretKey,
} from '@/services/runtime-config';
import { invokeTauri } from '@/services/tauri-bridge';
import { escapeHtml } from '@/utils/sanitize';
import { isDesktopRuntime } from '@/services/runtime';

const SIGNUP_URLS: Partial<Record<RuntimeSecretKey, string>> = {
  GROQ_API_KEY: 'https://console.groq.com/keys',
  OPENROUTER_API_KEY: 'https://openrouter.ai/settings/keys',
  CLOUDFLARE_API_TOKEN: 'https://dash.cloudflare.com/profile/api-tokens',
  ACLED_ACCESS_TOKEN: 'https://developer.acleddata.com/',
  URLHAUS_AUTH_KEY: 'https://auth.abuse.ch/',
  OTX_API_KEY: 'https://otx.alienvault.com/',
  ABUSEIPDB_API_KEY: 'https://www.abuseipdb.com/login',
  WINGBITS_API_KEY: 'https://wingbits.com/register',
  AISSTREAM_API_KEY: 'https://aisstream.io/authenticate',
  OPENSKY_CLIENT_ID: 'https://opensky-network.org/login?view=registration',
  OPENSKY_CLIENT_SECRET: 'https://opensky-network.org/login?view=registration',
  FINNHUB_API_KEY: 'https://finnhub.io/register',
  NASA_FIRMS_API_KEY: 'https://firms.modaps.eosdis.nasa.gov/api/area/',
};

const MASKED_SENTINEL = '__WM_MASKED__';

const SECRET_HELP_TEXT: Partial<Record<RuntimeSecretKey, string>> = {
  URLHAUS_AUTH_KEY: 'Used for both URLhaus and ThreatFox APIs.',
  OTX_API_KEY: 'Optional enrichment source for the cyber threat layer.',
  ABUSEIPDB_API_KEY: 'Optional enrichment source for malicious IP reputation.',
  FINNHUB_API_KEY: 'Real-time stock quotes and market data.',
  NASA_FIRMS_API_KEY: 'Fire Information for Resource Management System.',
};

interface RuntimeConfigPanelOptions {
  mode?: 'full' | 'alert';
  buffered?: boolean;
}

export class RuntimeConfigPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private readonly mode: 'full' | 'alert';
  private readonly buffered: boolean;
  private pendingSecrets = new Map<RuntimeSecretKey, string>();
  private validatedKeys = new Map<RuntimeSecretKey, boolean>();
  private validationMessages = new Map<RuntimeSecretKey, string>();

  constructor(options: RuntimeConfigPanelOptions = {}) {
    super({ id: 'runtime-config', title: 'Desktop Configuration', showCount: false });
    this.mode = options.mode ?? (isDesktopRuntime() ? 'alert' : 'full');
    this.buffered = options.buffered ?? false;
    this.unsubscribe = subscribeRuntimeConfig(() => this.render());
    this.render();
  }

  public async commitPendingSecrets(): Promise<void> {
    for (const [key, value] of this.pendingSecrets) {
      await setSecretValue(key, value);
    }
    this.pendingSecrets.clear();
    this.validatedKeys.clear();
    this.validationMessages.clear();
  }

  public async commitVerifiedSecrets(): Promise<void> {
    for (const [key, value] of this.pendingSecrets) {
      if (this.validatedKeys.get(key) !== false) {
        await setSecretValue(key, value);
        this.pendingSecrets.delete(key);
        this.validatedKeys.delete(key);
        this.validationMessages.delete(key);
      }
    }
  }

  public hasPendingChanges(): boolean {
    return this.pendingSecrets.size > 0;
  }

  public getValidationErrors(): string[] {
    const errors: string[] = [];
    for (const [key, value] of this.pendingSecrets) {
      const result = validateSecret(key, value);
      if (!result.valid) errors.push(`${key}: ${result.hint || 'Invalid format'}`);
    }
    return errors;
  }

  public async verifyPendingSecrets(): Promise<string[]> {
    this.captureUnsavedInputs();
    const errors: string[] = [];
    const context = Object.fromEntries(this.pendingSecrets.entries()) as Partial<Record<RuntimeSecretKey, string>>;

    for (const [key, value] of this.pendingSecrets) {
      const localResult = validateSecret(key, value);
      if (!localResult.valid) {
        this.validatedKeys.set(key, false);
        this.validationMessages.set(key, localResult.hint || 'Invalid format');
        errors.push(`${key}: ${localResult.hint || 'Invalid format'}`);
        continue;
      }

      const verifyResult = await verifySecretWithApi(key, value, context);
      this.validatedKeys.set(key, verifyResult.valid);
      if (!verifyResult.valid) {
        this.validationMessages.set(key, verifyResult.message || 'Verification failed');
        errors.push(`${key}: ${verifyResult.message || 'Verification failed'}`);
      } else {
        this.validationMessages.delete(key);
      }
    }

    if (this.pendingSecrets.size > 0) {
      this.render();
    }

    return errors;
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private captureUnsavedInputs(): void {
    if (!this.buffered) return;
    this.content.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => {
      const key = input.dataset.secret as RuntimeSecretKey | undefined;
      if (!key) return;
      const raw = input.value.trim();
      if (!raw || raw === MASKED_SENTINEL) return;
      this.pendingSecrets.set(key, raw);
      const result = validateSecret(key, raw);
      if (!result.valid) {
        this.validatedKeys.set(key, false);
        this.validationMessages.set(key, result.hint || 'Invalid format');
      }
    });
  }

  protected render(): void {
    this.captureUnsavedInputs();
    const snapshot = getRuntimeConfigSnapshot();
    const desktop = isDesktopRuntime();

    if (desktop && this.mode === 'alert') {
      const totalFeatures = RUNTIME_FEATURES.length;
      const availableFeatures = RUNTIME_FEATURES.filter((feature) => isFeatureAvailable(feature.id)).length;
      const missingFeatures = Math.max(0, totalFeatures - availableFeatures);
      const configuredCount = Object.keys(snapshot.secrets).length;
      const alertTitle = configuredCount > 0
        ? (missingFeatures > 0 ? 'Some features need API keys' : 'Desktop settings configured')
        : 'Configure API keys to unlock features';
      const alertClass = missingFeatures > 0 ? 'warn' : 'ok';

      this.content.innerHTML = `
        <section class="runtime-alert runtime-alert-${alertClass}">
          <h3>${alertTitle}</h3>
          <p>
            ${availableFeatures}/${totalFeatures} features available${configuredCount > 0 ? ` · ${configuredCount} secrets configured` : ''}.
          </p>
          <button type="button" class="runtime-open-settings-btn" data-open-settings>
            Open Settings
          </button>
        </section>
      `;
      this.attachListeners();
      return;
    }

    this.content.innerHTML = `
      <div class="runtime-config-summary">
        ${desktop ? 'Desktop mode' : 'Web mode (read-only, server-managed credentials)'} · ${Object.keys(snapshot.secrets).length} local secrets configured · ${RUNTIME_FEATURES.filter(f => isFeatureAvailable(f.id)).length}/${RUNTIME_FEATURES.length} features available
      </div>
      <div class="runtime-config-list">
        ${RUNTIME_FEATURES.map(feature => this.renderFeature(feature)).join('')}
      </div>
    `;

    this.attachListeners();
  }

  private renderFeature(feature: RuntimeFeatureDefinition): string {
    const enabled = isFeatureEnabled(feature.id);
    const available = isFeatureAvailable(feature.id);
    const effectiveSecrets = getEffectiveSecrets(feature);
    const allStaged = !available && effectiveSecrets.every(
      (k) => getSecretState(k).valid || (this.pendingSecrets.has(k) && this.validatedKeys.get(k) !== false)
    );
    const pillClass = available ? 'ok' : allStaged ? 'staged' : 'warn';
    const pillLabel = available ? 'Ready' : allStaged ? 'Staged' : 'Needs Keys';
    const secrets = effectiveSecrets.map((key) => this.renderSecretRow(key)).join('');
    const desktop = isDesktopRuntime();
    const fallbackHtml = available || allStaged ? '' : `<p class="runtime-feature-fallback fallback">${escapeHtml(feature.fallback)}</p>`;

    return `
      <section class="runtime-feature ${available ? 'available' : allStaged ? 'staged' : 'degraded'}">
        <header class="runtime-feature-header">
          <label>
            <input type="checkbox" data-toggle="${feature.id}" ${enabled ? 'checked' : ''} ${desktop ? '' : 'disabled'}>
            <span>${escapeHtml(feature.name)}</span>
          </label>
          <span class="runtime-pill ${pillClass}">${pillLabel}</span>
        </header>
        <div class="runtime-secrets">${secrets}</div>
        ${fallbackHtml}
      </section>
    `;
  }

  private renderSecretRow(key: RuntimeSecretKey): string {
    const state = getSecretState(key);
    const pending = this.pendingSecrets.has(key);
    const pendingValid = pending ? this.validatedKeys.get(key) : undefined;
    const status = pending
      ? (pendingValid === false ? 'Invalid' : 'Staged')
      : !state.present ? 'Missing' : state.valid ? `Valid (${state.source})` : 'Looks invalid';
    const statusClass = pending
      ? (pendingValid === false ? 'warn' : 'staged')
      : state.valid ? 'ok' : 'warn';
    const signupUrl = SIGNUP_URLS[key];
    const helpText = SECRET_HELP_TEXT[key];
    const linkHtml = signupUrl
      ? ` <a href="#" data-signup-url="${signupUrl}" class="runtime-secret-link" title="Get API key">&#x2197;</a>`
      : '';
    const validated = this.validatedKeys.get(key);
    const inputClass = pending ? (validated === false ? 'invalid' : 'valid-staged') : '';
    const checkClass = validated === true ? 'visible' : '';
    const hintText = pending && validated === false
      ? (this.validationMessages.get(key) || validateSecret(key, this.pendingSecrets.get(key) || '').hint || 'Invalid value')
      : null;

    return `
      <div class="runtime-secret-row">
        <div class="runtime-secret-key"><code>${escapeHtml(key)}</code>${linkHtml}</div>
        <span class="runtime-secret-status ${statusClass}">${escapeHtml(status)}</span>
        <span class="runtime-secret-check ${checkClass}">&#x2713;</span>
        ${helpText ? `<div class="runtime-secret-meta">${escapeHtml(helpText)}</div>` : ''}
        <input type="password" data-secret="${key}" placeholder="${pending ? 'Staged (save with OK)' : 'Set secret'}" autocomplete="off" ${isDesktopRuntime() ? '' : 'disabled'} class="${inputClass}" ${pending ? `value="${MASKED_SENTINEL}"` : ''}>
        ${hintText ? `<span class="runtime-secret-hint">${escapeHtml(hintText)}</span>` : ''}
      </div>
    `;
  }

  private attachListeners(): void {
    this.content.querySelectorAll<HTMLAnchorElement>('a[data-signup-url]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = link.dataset.signupUrl;
        if (!url) return;
        if (isDesktopRuntime()) {
          void invokeTauri<void>('open_url', { url }).catch(() => window.open(url, '_blank'));
        } else {
          window.open(url, '_blank');
        }
      });
    });

    if (!isDesktopRuntime()) return;

    if (this.mode === 'alert') {
      this.content.querySelector<HTMLButtonElement>('[data-open-settings]')?.addEventListener('click', () => {
        void invokeTauri<void>('open_settings_window_command').catch((error) => {
          console.warn('[runtime-config] Failed to open settings window', error);
        });
      });
      return;
    }

    this.content.querySelectorAll<HTMLInputElement>('input[data-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const featureId = input.dataset.toggle as RuntimeFeatureDefinition['id'] | undefined;
        if (!featureId) return;
        setFeatureToggle(featureId, input.checked);
      });
    });

    this.content.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.secret as RuntimeSecretKey | undefined;
        if (!key) return;
        if (this.buffered && this.pendingSecrets.has(key) && input.value.startsWith(MASKED_SENTINEL)) {
          input.value = input.value.slice(MASKED_SENTINEL.length);
        }
        this.validatedKeys.delete(key);
        this.validationMessages.delete(key);
        const check = input.closest('.runtime-secret-row')?.querySelector('.runtime-secret-check');
        check?.classList.remove('visible');
        input.classList.remove('valid-staged', 'invalid');
        const hint = input.closest('.runtime-secret-row')?.querySelector('.runtime-secret-hint');
        if (hint) hint.remove();
      });

      input.addEventListener('blur', () => {
        const key = input.dataset.secret as RuntimeSecretKey | undefined;
        if (!key) return;
        const raw = input.value.trim();
        if (!raw) {
          if (this.buffered && this.pendingSecrets.has(key)) {
            this.pendingSecrets.delete(key);
            this.validatedKeys.delete(key);
            this.validationMessages.delete(key);
            this.render();
          }
          return;
        }
        if (raw === MASKED_SENTINEL) return;
        if (this.buffered) {
          this.pendingSecrets.set(key, raw);
          const result = validateSecret(key, raw);
          if (result.valid) {
            this.validatedKeys.delete(key);
            this.validationMessages.delete(key);
          } else {
            this.validatedKeys.set(key, false);
            this.validationMessages.set(key, result.hint || 'Invalid format');
          }
          input.type = 'password';
          input.value = MASKED_SENTINEL;
          input.placeholder = 'Staged (save with OK)';
          const row = input.closest('.runtime-secret-row');
          const check = row?.querySelector('.runtime-secret-check');
          input.classList.remove('valid-staged', 'invalid');
          if (result.valid) {
            check?.classList.remove('visible');
            input.classList.add('valid-staged');
          } else {
            check?.classList.remove('visible');
            input.classList.add('invalid');
            const existingHint = row?.querySelector('.runtime-secret-hint');
            if (existingHint) existingHint.remove();
            if (result.hint) {
              const hint = document.createElement('span');
              hint.className = 'runtime-secret-hint';
              hint.textContent = result.hint;
              row?.appendChild(hint);
            }
          }
        } else {
          void setSecretValue(key, raw);
          input.value = '';
        }
      });
    });
  }
}
