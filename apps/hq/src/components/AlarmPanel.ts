import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { debounce } from '@/utils/index';

// --- Types ---
type AlarmMode = 'alarms' | 'countdown' | 'stopwatch' | 'pomodoro' | 'world';

interface AlarmItem {
  id: string;
  time: string;         // HH:MM
  label: string;
  enabled: boolean;
  repeatDays: boolean[]; // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
}

interface LapEntry {
  lapNum: number;
  splitMs: number;
  totalMs: number;
}

interface WorldCity {
  name: string;
  timezone: string;
}

const ALARM_KEY = 'hq-alarm-data';
const POMO_KEY = 'hq-pomodoro-sessions';
const WORLD_KEY = 'hq-world-time-cities';
const SAVE_DEBOUNCE_MS = 400;

const MODE_LABELS: { key: AlarmMode; label: string }[] = [
  { key: 'alarms', label: 'Alarms' },
  { key: 'countdown', label: 'Timer' },
  { key: 'stopwatch', label: 'Stopwatch' },
  { key: 'pomodoro', label: 'Pomodoro' },
  { key: 'world', label: 'World' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WORLD_CITIES: WorldCity[] = [
  { name: 'New York', timezone: 'America/New_York' },
  { name: 'London', timezone: 'Europe/London' },
  { name: 'Tokyo', timezone: 'Asia/Tokyo' },
  { name: 'Dubai', timezone: 'Asia/Dubai' },
  { name: 'Sydney', timezone: 'Australia/Sydney' },
  { name: 'Paris', timezone: 'Europe/Paris' },
  { name: 'Singapore', timezone: 'Asia/Singapore' },
  { name: 'Hong Kong', timezone: 'Asia/Hong_Kong' },
  { name: 'Mumbai', timezone: 'Asia/Kolkata' },
  { name: 'São Paulo', timezone: 'America/Sao_Paulo' },
  { name: 'Los Angeles', timezone: 'America/Los_Angeles' },
  { name: 'Chicago', timezone: 'America/Chicago' },
  { name: 'Berlin', timezone: 'Europe/Berlin' },
  { name: 'Moscow', timezone: 'Europe/Moscow' },
  { name: 'Beijing', timezone: 'Asia/Shanghai' },
  { name: 'Seoul', timezone: 'Asia/Seoul' },
  { name: 'Istanbul', timezone: 'Europe/Istanbul' },
  { name: 'Lagos', timezone: 'Africa/Lagos' },
  { name: 'Cairo', timezone: 'Africa/Cairo' },
  { name: 'Nairobi', timezone: 'Africa/Nairobi' },
  { name: 'Buenos Aires', timezone: 'America/Argentina/Buenos_Aires' },
  { name: 'Mexico City', timezone: 'America/Mexico_City' },
  { name: 'Toronto', timezone: 'America/Toronto' },
  { name: 'Denver', timezone: 'America/Denver' },
  { name: 'Honolulu', timezone: 'Pacific/Honolulu' },
  { name: 'Auckland', timezone: 'Pacific/Auckland' },
  { name: 'Bangkok', timezone: 'Asia/Bangkok' },
  { name: 'Jakarta', timezone: 'Asia/Jakarta' },
  { name: 'Riyadh', timezone: 'Asia/Riyadh' },
  { name: 'Zurich', timezone: 'Europe/Zurich' },
];

const DEFAULT_CITIES = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Asia/Dubai'];

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function padZ(n: number, digits = 2): string {
  return String(n).padStart(digits, '0');
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${padZ(min)}:${padZ(sec)}.${padZ(cs)}`;
}

function formatMsSplit(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1);
  return `${m}m ${s}s`;
}

/** Lazily creates and reuses a single AudioContext (avoids browser limits). */
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContext();
    }
    // Resume if suspended (browser autoplay policy)
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => { /* ignore */ });
    }
    return sharedAudioCtx;
  } catch { return null; }
}

function playBeep(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const playTone = (delay: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.15);
    };
    playTone(0);
    playTone(0.2);
    playTone(0.4);
  } catch { /* audio not available */ }
}

function getTimeInTz(tz: string): { time: string; date: string; hour: number; utcOffset: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const parts = fmt.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');

  // Dynamically compute UTC offset (DST-aware) using Intl
  let utcOffset = '';
  try {
    const longFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const tzPart = longFmt.formatToParts(now).find(p => p.type === 'timeZoneName');
    utcOffset = tzPart?.value || '';
    // Normalize "GMT" to "UTC", "GMT+5:30" to "UTC+5:30"
    utcOffset = utcOffset.replace(/^GMT/, 'UTC');
  } catch {
    utcOffset = tz;
  }

  return { time: fmt.format(now), date: dateFmt.format(now), hour, utcOffset };
}

/** Validate an alarm item from localStorage. */
function isValidAlarm(v: unknown): v is AlarmItem {
  if (!isObject(v)) return false;
  const a = v as Record<string, unknown>;
  return isString(a.id) && isString(a.time) && /^\d{2}:\d{2}$/.test(a.time as string)
    && isString(a.label) && typeof a.enabled === 'boolean'
    && Array.isArray(a.repeatDays) && (a.repeatDays as unknown[]).length === 7
    && (a.repeatDays as unknown[]).every(d => typeof d === 'boolean');
}

function validateAlarms(raw: unknown): AlarmItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(isValidAlarm).slice(0, 50);
}

export class AlarmPanel extends Panel {
  private mode: AlarmMode = 'alarms';

  // Alarms
  private alarms: AlarmItem[] = [];
  private triggeredIds = new Set<string>();
  private alarmCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Countdown
  private cdHours = 0;
  private cdMinutes = 5;
  private cdSeconds = 0;
  private cdRunning = false;
  private cdRemaining = 0;
  private cdTotal = 0;
  private cdEndTime = 0;
  private cdInterval: ReturnType<typeof setInterval> | null = null;

  // Stopwatch
  private swRunning = false;
  private swElapsed = 0;
  private swStartTime = 0;
  private swOffset = 0;
  private swLaps: LapEntry[] = [];
  private swRaf: number | null = null;

  // Pomodoro
  private pomPhase: 'focus' | 'break' = 'focus';
  private pomSessions = 0;
  private pomRunning = false;
  private pomRemaining = 25 * 60;
  private pomTotal = 25 * 60;
  private pomEndTime = 0;
  private pomInterval: ReturnType<typeof setInterval> | null = null;

  // World
  private selectedCities: string[] = [];
  private worldInterval: ReturnType<typeof setInterval> | null = null;

  // Persistence
  private readonly debouncedSaveAlarms: () => void;
  private boundVisibilityHandler: (() => void) | null = null;

  constructor() {
    super({ id: 'alarm', title: 'Alarm & Timer', className: 'alarm-panel' });
    this.debouncedSaveAlarms = debounce(() => this.persistAlarmsNow(), SAVE_DEBOUNCE_MS);
    this.loadAll();
    this.render();
    this.startAlarmCheck();
    this.setupVisibilityHandler();
  }

  // --- Persistence ---
  private loadAll(): void {
    try {
      const raw = localStorage.getItem(ALARM_KEY);
      if (raw) this.alarms = validateAlarms(JSON.parse(raw));
    } catch { /* ignore */ }
    try {
      const s = localStorage.getItem(POMO_KEY);
      if (s) {
        const parsed = parseInt(s);
        this.pomSessions = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      }
    } catch { /* ignore */ }
    try {
      const c = localStorage.getItem(WORLD_KEY);
      if (c) {
        const parsed = JSON.parse(c);
        this.selectedCities = Array.isArray(parsed)
          ? (parsed as unknown[]).filter(isString).slice(0, 20)
          : [...DEFAULT_CITIES];
      } else {
        this.selectedCities = [...DEFAULT_CITIES];
      }
    } catch {
      this.selectedCities = [...DEFAULT_CITIES];
    }
  }

  private persistAlarmsNow(): void {
    localStorage.setItem(ALARM_KEY, JSON.stringify(this.alarms));
  }

  private saveAlarms(): void {
    this.debouncedSaveAlarms();
  }

  private savePomSessions(): void {
    localStorage.setItem(POMO_KEY, String(this.pomSessions));
  }

  private saveCities(): void {
    localStorage.setItem(WORLD_KEY, JSON.stringify(this.selectedCities));
  }

  /** Handle tab visibility changes - resume stopwatch RAF and recalc timer state. */
  private setupVisibilityHandler(): void {
    this.boundVisibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        // Resume RAF-based stopwatch tick when tab becomes visible
        if (this.mode === 'stopwatch' && this.swRunning) {
          this.swElapsed = this.swOffset + (Date.now() - this.swStartTime);
          this.tickStopwatch();
        }
        // Force immediate recalc for countdown/pomodoro (interval-based, but may have drifted)
        if (this.mode === 'countdown' && this.cdRunning) {
          this.cdRemaining = Math.max(0, Math.round((this.cdEndTime - Date.now()) / 1000));
          if (this.cdRemaining <= 0) {
            this.cdRunning = false;
            playBeep();
          }
          this.render();
        }
        if (this.mode === 'pomodoro' && this.pomRunning) {
          this.pomRemaining = Math.max(0, Math.round((this.pomEndTime - Date.now()) / 1000));
          if (this.pomRemaining <= 0) {
            this.pomRunning = false;
            playBeep();
            this.advancePomodoro();
          }
          this.render();
        }
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  // --- Alarm Checking ---
  private startAlarmCheck(): void {
    this.alarmCheckInterval = setInterval(() => this.checkAlarms(), 30000);
  }

  private checkAlarms(): void {
    const now = new Date();
    const hh = padZ(now.getHours());
    const mm = padZ(now.getMinutes());
    const timeStr = `${hh}:${mm}`;
    const dayIdx = (now.getDay() + 6) % 7; // Mon=0

    this.alarms.forEach(a => {
      if (!a.enabled || this.triggeredIds.has(a.id)) return;
      if (a.time !== timeStr) return;
      const hasRepeat = a.repeatDays.some(Boolean);
      if (hasRepeat && !a.repeatDays[dayIdx]) return;
      this.triggeredIds.add(a.id);
      playBeep();
      this.render();
      // Clear triggered after 2 minutes
      setTimeout(() => { this.triggeredIds.delete(a.id); this.render(); }, 120000);
    });
  }

  private getTimeRemaining(a: AlarmItem): string {
    const now = new Date();
    const parts = a.time.split(':').map(Number);
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    let target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target = new Date(target.getTime() + 86400000);
    const diff = target.getTime() - now.getTime();
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `in ${hrs}h ${mins}m`;
  }

  // --- Clear intervals ---
  private clearAll(): void {
    if (this.cdInterval) { clearInterval(this.cdInterval); this.cdInterval = null; }
    if (this.swRaf) { cancelAnimationFrame(this.swRaf); this.swRaf = null; }
    if (this.pomInterval) { clearInterval(this.pomInterval); this.pomInterval = null; }
    if (this.worldInterval) { clearInterval(this.worldInterval); this.worldInterval = null; }
  }

  // --- Render ---
  private render(): void {
    this.clearAll();

    const tabs = MODE_LABELS.map(m =>
      `<button class="alarm-tab ${this.mode === m.key ? 'active' : ''}" data-mode="${m.key}">${m.label}</button>`
    ).join('');

    let body = '';
    switch (this.mode) {
      case 'alarms': body = this.renderAlarms(); break;
      case 'countdown': body = this.renderCountdown(); break;
      case 'stopwatch': body = this.renderStopwatch(); break;
      case 'pomodoro': body = this.renderPomodoro(); break;
      case 'world': body = this.renderWorld(); break;
    }

    this.setContent(`
      <div class="alarm-container">
        <div class="alarm-tabs">${tabs}</div>
        <div class="alarm-body">${body}</div>
      </div>
    `);
    this.bindTabs();
    this.bindView();
  }

  private bindTabs(): void {
    this.content.querySelectorAll('.alarm-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mode = (btn as HTMLElement).dataset.mode as AlarmMode;
        this.render();
      });
    });
  }

  // --- Alarms View ---
  private renderAlarms(): string {
    const triggered = Array.from(this.triggeredIds);
    const dismissBanner = triggered.length > 0
      ? `<div class="alarm-dismiss-banner alarm-flash">⏰ Alarm ringing! <button class="alarm-dismiss-btn">Dismiss</button></div>`
      : '';

    const alarmList = this.alarms.map(a => {
      const days = a.repeatDays.map((on, i) =>
        `<span class="alarm-day-tag ${on ? 'active' : ''}">${DAY_LABELS[i]}</span>`
      ).join('');
      const remaining = a.enabled ? `<span class="alarm-remaining">${this.getTimeRemaining(a)}</span>` : '';
      return `<div class="alarm-row ${this.triggeredIds.has(a.id) ? 'alarm-flash' : ''}" data-id="${a.id}">
        <div class="alarm-row-left">
          <span class="alarm-time-display">${escapeHtml(a.time)}</span>
          ${a.label ? `<span class="alarm-label">${escapeHtml(a.label)}</span>` : ''}
          ${remaining}
        </div>
        <div class="alarm-row-days">${days}</div>
        <div class="alarm-row-right">
          <button class="alarm-toggle-btn ${a.enabled ? 'on' : ''}" data-id="${a.id}">${a.enabled ? 'ON' : 'OFF'}</button>
          <button class="alarm-del-btn" data-id="${a.id}">×</button>
        </div>
      </div>`;
    }).join('');

    return `${dismissBanner}
      <div class="alarm-add-form">
        <div class="alarm-add-row">
          <input type="number" class="alarm-num-input" id="alarmH" min="0" max="23" value="7" />
          <span class="alarm-colon">:</span>
          <input type="number" class="alarm-num-input" id="alarmM" min="0" max="59" value="0" />
          <input class="alarm-label-input" id="alarmLabel" placeholder="Label (optional)" maxlength="50" />
        </div>
        <div class="alarm-add-days">
          ${DAY_LABELS.map((d, i) => `<button class="alarm-day-btn" data-idx="${i}">${d}</button>`).join('')}
        </div>
        <button class="alarm-add-btn">+ Add Alarm</button>
      </div>
      <div class="alarm-list">${alarmList || '<div class="alarm-empty">No alarms set</div>'}</div>
    `;
  }

  // --- Countdown Timer ---
  private renderCountdown(): string {
    const pct = this.cdTotal > 0 ? ((this.cdTotal - this.cdRemaining) / this.cdTotal) * 100 : 0;
    const circumference = 2 * Math.PI * 60;
    const offset = circumference - (pct / 100) * circumference;

    const mm = Math.floor(this.cdRemaining / 60);
    const ss = this.cdRemaining % 60;
    const displayH = Math.floor(mm / 60);
    const displayM = mm % 60;

    return `<div class="alarm-cd-wrap">
      <svg class="alarm-cd-svg" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="60" fill="none" stroke="var(--border)" stroke-width="6" />
        <circle class="alarm-cd-ring" cx="70" cy="70" r="60" fill="none" stroke="var(--accent)" stroke-width="6"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" />
        <text class="alarm-cd-time" x="70" y="75" text-anchor="middle" fill="var(--text)" font-family="monospace" font-size="20">
          ${padZ(displayH)}:${padZ(displayM)}:${padZ(ss)}
        </text>
      </svg>
      ${!this.cdRunning && this.cdRemaining === 0 ? `
        <div class="alarm-cd-inputs">
          <label>H<input type="number" class="alarm-num-input" id="cdH" min="0" max="99" value="${this.cdHours}" /></label>
          <label>M<input type="number" class="alarm-num-input" id="cdM" min="0" max="59" value="${this.cdMinutes}" /></label>
          <label>S<input type="number" class="alarm-num-input" id="cdS" min="0" max="59" value="${this.cdSeconds}" /></label>
        </div>` : ''}
      <div class="alarm-cd-controls">
        ${!this.cdRunning && this.cdRemaining === 0 ? '<button class="alarm-btn" data-cd="start">Start</button>' : ''}
        ${this.cdRunning ? '<button class="alarm-btn" data-cd="pause">Pause</button>' : ''}
        ${!this.cdRunning && this.cdRemaining > 0 ? '<button class="alarm-btn" data-cd="resume">Resume</button>' : ''}
        ${this.cdRemaining > 0 || this.cdRunning ? '<button class="alarm-btn secondary" data-cd="reset">Reset</button>' : ''}
      </div>
    </div>`;
  }

  // --- Stopwatch ---
  private renderStopwatch(): string {
    let fastestIdx = -1, slowestIdx = -1;
    if (this.swLaps.length >= 2) {
      let minSplit = Infinity, maxSplit = 0;
      this.swLaps.forEach((lap, i) => {
        if (lap.splitMs < minSplit) { minSplit = lap.splitMs; fastestIdx = i; }
        if (lap.splitMs > maxSplit) { maxSplit = lap.splitMs; slowestIdx = i; }
      });
    }

    const laps = this.swLaps.map((lap, i) => {
      let cls = '';
      if (i === fastestIdx) cls = 'fastest';
      else if (i === slowestIdx) cls = 'slowest';
      return `<div class="alarm-sw-lap ${cls}">
        <span>Lap ${lap.lapNum}</span>
        <span>${formatMsSplit(lap.splitMs)}</span>
        <span>${formatMs(lap.totalMs)}</span>
      </div>`;
    }).join('');

    return `<div class="alarm-sw-wrap">
      <div class="alarm-sw-display">${formatMs(this.swElapsed)}</div>
      <div class="alarm-sw-controls">
        ${!this.swRunning ? '<button class="alarm-btn" data-sw="start">Start</button>' : ''}
        ${this.swRunning ? '<button class="alarm-btn" data-sw="stop">Stop</button>' : ''}
        ${this.swRunning ? '<button class="alarm-btn secondary" data-sw="lap">Lap</button>' : ''}
        ${!this.swRunning && this.swElapsed > 0 ? '<button class="alarm-btn" data-sw="resume">Resume</button>' : ''}
        ${!this.swRunning && this.swElapsed > 0 ? '<button class="alarm-btn secondary" data-sw="reset">Reset</button>' : ''}
      </div>
      ${this.swLaps.length > 0 ? `<div class="alarm-sw-laps">${laps}</div>` : ''}
    </div>`;
  }

  // --- Pomodoro ---
  private renderPomodoro(): string {
    const label = this.pomPhase === 'focus' ? 'FOCUS' : 'BREAK';
    const color = this.pomPhase === 'focus' ? '#ef4444' : '#22c55e';
    const pct = this.pomTotal > 0 ? ((this.pomTotal - this.pomRemaining) / this.pomTotal) * 100 : 0;
    const circumference = 2 * Math.PI * 60;
    const offset = circumference - (pct / 100) * circumference;
    const mm = Math.floor(this.pomRemaining / 60);
    const ss = this.pomRemaining % 60;

    return `<div class="alarm-pom-wrap">
      <svg class="alarm-cd-svg" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="60" fill="none" stroke="var(--border)" stroke-width="6" />
        <circle class="alarm-cd-ring" cx="70" cy="70" r="60" fill="none" stroke="${color}" stroke-width="6"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" />
        <text x="70" y="60" text-anchor="middle" fill="${color}" font-family="monospace" font-size="12" font-weight="bold">${label}</text>
        <text class="alarm-cd-time" x="70" y="85" text-anchor="middle" fill="var(--text)" font-family="monospace" font-size="22">${padZ(mm)}:${padZ(ss)}</text>
      </svg>
      <div class="alarm-pom-sessions">Sessions: ${this.pomSessions}</div>
      <div class="alarm-pom-controls">
        ${!this.pomRunning ? `<button class="alarm-btn" data-pom="start">${this.pomRemaining < this.pomTotal ? 'Resume' : 'Start'}</button>` : ''}
        ${this.pomRunning ? '<button class="alarm-btn" data-pom="pause">Pause</button>' : ''}
        <button class="alarm-btn secondary" data-pom="reset">Reset</button>
        <button class="alarm-btn secondary" data-pom="skip">Skip</button>
      </div>
    </div>`;
  }

  // --- World Time ---
  private renderWorld(): string {
    const available = WORLD_CITIES.filter(c => !this.selectedCities.includes(c.timezone));

    const cities = this.selectedCities
      .map(tz => WORLD_CITIES.find(c => c.timezone === tz))
      .filter((c): c is WorldCity => !!c);

    const cityCards = cities.map(c => {
      const info = getTimeInTz(c.timezone);
      const icon = info.hour >= 6 && info.hour < 18 ? '☀️' : '🌙';
      return `<div class="alarm-world-card" data-tz="${c.timezone}">
        <div class="alarm-world-left">
          <span class="alarm-world-icon">${icon}</span>
          <div>
            <div class="alarm-world-name">${escapeHtml(c.name)}</div>
            <div class="alarm-world-date">${info.date} · ${info.utcOffset}</div>
          </div>
        </div>
        <div class="alarm-world-time">${info.time}</div>
        <button class="alarm-world-remove" data-tz="${c.timezone}" title="Remove">×</button>
      </div>`;
    }).join('');

    const picker = available.length > 0 ? `
      <div class="alarm-world-add">
        <select class="alarm-world-select" id="worldCitySelect">
          <option value="">+ Add city…</option>
          ${available.map(c => {
            const info = getTimeInTz(c.timezone);
            return `<option value="${c.timezone}">${escapeHtml(c.name)} (${info.utcOffset})</option>`;
          }).join('')}
        </select>
      </div>` : '';

    return `<div class="alarm-world-wrap">${cityCards}${picker}</div>`;
  }

  // --- Bindings ---
  private bindView(): void {
    switch (this.mode) {
      case 'alarms': this.bindAlarms(); break;
      case 'countdown': this.bindCountdown(); break;
      case 'stopwatch': this.bindStopwatch(); break;
      case 'pomodoro': this.bindPomodoro(); break;
      case 'world': this.bindWorld(); break;
    }
  }

  private bindAlarms(): void {
    // Dismiss
    this.content.querySelector('.alarm-dismiss-btn')?.addEventListener('click', () => {
      this.triggeredIds.clear();
      this.render();
    });

    // Add alarm
    const dayState = [false, false, false, false, false, false, false];
    this.content.querySelectorAll('.alarm-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx!);
        dayState[idx] = !dayState[idx];
        btn.classList.toggle('active', dayState[idx]);
      });
    });

    this.content.querySelector('.alarm-add-btn')?.addEventListener('click', () => {
      const h = parseInt((this.content.querySelector('#alarmH') as HTMLInputElement)?.value || '0');
      const m = parseInt((this.content.querySelector('#alarmM') as HTMLInputElement)?.value || '0');
      const label = (this.content.querySelector('#alarmLabel') as HTMLInputElement)?.value.trim() || '';
      this.alarms.push({
        id: uid(),
        time: `${padZ(Math.min(23, Math.max(0, h)))}:${padZ(Math.min(59, Math.max(0, m)))}`,
        label,
        enabled: true,
        repeatDays: [...dayState],
      });
      this.saveAlarms();
      this.render();
    });

    // Toggle / delete
    this.content.querySelectorAll('.alarm-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const a = this.alarms.find(x => x.id === id);
        if (a) { a.enabled = !a.enabled; this.saveAlarms(); this.render(); }
      });
    });
    this.content.querySelectorAll('.alarm-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.alarms = this.alarms.filter(a => a.id !== id);
        this.saveAlarms();
        this.render();
      });
    });
  }

  private bindCountdown(): void {
    this.content.querySelectorAll('[data-cd]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.cd!;
        if (action === 'start') {
          this.cdHours = parseInt((this.content.querySelector('#cdH') as HTMLInputElement)?.value || '0');
          this.cdMinutes = parseInt((this.content.querySelector('#cdM') as HTMLInputElement)?.value || '0');
          this.cdSeconds = parseInt((this.content.querySelector('#cdS') as HTMLInputElement)?.value || '0');
          this.cdTotal = this.cdHours * 3600 + this.cdMinutes * 60 + this.cdSeconds;
          this.cdRemaining = this.cdTotal;
          if (this.cdTotal <= 0) return;
          this.cdRunning = true;
          this.cdEndTime = Date.now() + this.cdRemaining * 1000;
          this.render(); // render → bindCountdown → startCountdownTick
        } else if (action === 'pause') {
          this.cdRunning = false;
          this.cdRemaining = Math.max(0, Math.round((this.cdEndTime - Date.now()) / 1000));
          this.render();
        } else if (action === 'resume') {
          this.cdRunning = true;
          this.cdEndTime = Date.now() + this.cdRemaining * 1000;
          this.render(); // render → bindCountdown → startCountdownTick
        } else if (action === 'reset') {
          this.cdRunning = false;
          this.cdRemaining = 0;
          this.cdTotal = 0;
          this.render();
        }
      });
    });

    if (this.cdRunning) this.startCountdownTick();
  }

  /** Targeted countdown tick - updates only SVG ring + time text (no DOM rebuild). */
  private startCountdownTick(): void {
    if (this.cdInterval) clearInterval(this.cdInterval);
    this.cdInterval = setInterval(() => {
      this.cdRemaining = Math.max(0, Math.round((this.cdEndTime - Date.now()) / 1000));

      // Targeted DOM updates - avoid full re-render
      const ring = this.content.querySelector('.alarm-cd-ring');
      const timeText = this.content.querySelector('.alarm-cd-time');
      if (ring && timeText) {
        const pct = this.cdTotal > 0 ? ((this.cdTotal - this.cdRemaining) / this.cdTotal) * 100 : 0;
        const circumference = 2 * Math.PI * 60;
        const offset = circumference - (pct / 100) * circumference;
        ring.setAttribute('stroke-dashoffset', String(offset));
        const mm = Math.floor(this.cdRemaining / 60);
        const ss = this.cdRemaining % 60;
        const dH = Math.floor(mm / 60);
        const dM = mm % 60;
        timeText.textContent = `${padZ(dH)}:${padZ(dM)}:${padZ(ss)}`;
      }

      if (this.cdRemaining <= 0) {
        this.cdRunning = false;
        if (this.cdInterval) { clearInterval(this.cdInterval); this.cdInterval = null; }
        playBeep();
        this.render(); // Full re-render only on completion (show reset UI)
      }
    }, 250);
  }

  private bindStopwatch(): void {
    this.content.querySelectorAll('[data-sw]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.sw!;
        if (action === 'start') {
          this.swRunning = true;
          this.swStartTime = Date.now();
          this.swOffset = 0;
          this.swElapsed = 0;
          this.swLaps = [];
          this.tickStopwatch();
        } else if (action === 'stop') {
          this.swRunning = false;
          this.swOffset = this.swElapsed;
          this.render();
        } else if (action === 'resume') {
          this.swRunning = true;
          this.swStartTime = Date.now();
          this.tickStopwatch();
        } else if (action === 'lap') {
          const lastLap = this.swLaps.length > 0 ? this.swLaps[this.swLaps.length - 1] : undefined;
          const lastLapTotal = lastLap ? lastLap.totalMs : 0;
          this.swLaps.push({
            lapNum: this.swLaps.length + 1,
            splitMs: this.swElapsed - lastLapTotal,
            totalMs: this.swElapsed,
          });
          // Targeted DOM insert for laps instead of full re-render (prevents flicker)
          this.updateLapDisplay();
          // Stopwatch keeps ticking - RAF was never stopped
        } else if (action === 'reset') {
          this.swRunning = false;
          this.swElapsed = 0;
          this.swOffset = 0;
          this.swLaps = [];
          this.render();
        }
      });
    });

    if (this.swRunning) this.tickStopwatch();
  }

  private tickStopwatch(): void {
    if (this.swRaf) cancelAnimationFrame(this.swRaf);
    const tick = () => {
      if (!this.swRunning) return;
      this.swElapsed = this.swOffset + (Date.now() - this.swStartTime);
      const display = this.content.querySelector('.alarm-sw-display');
      if (display) display.textContent = formatMs(this.swElapsed);
      this.swRaf = requestAnimationFrame(tick);
    };
    this.swRaf = requestAnimationFrame(tick);
  }

  /** Targeted lap display update - avoids full re-render which would kill the RAF loop. */
  private updateLapDisplay(): void {
    let lapsContainer = this.content.querySelector('.alarm-sw-laps');
    if (!lapsContainer) {
      // Create laps container if it doesn't exist yet
      lapsContainer = document.createElement('div');
      lapsContainer.className = 'alarm-sw-laps';
      const wrap = this.content.querySelector('.alarm-sw-wrap');
      if (wrap) wrap.appendChild(lapsContainer);
    }

    // Rebuild all laps (need to recalculate fastest/slowest)
    let fastestIdx = -1, slowestIdx = -1;
    if (this.swLaps.length >= 2) {
      let minSplit = Infinity, maxSplit = 0;
      this.swLaps.forEach((lap, i) => {
        if (lap.splitMs < minSplit) { minSplit = lap.splitMs; fastestIdx = i; }
        if (lap.splitMs > maxSplit) { maxSplit = lap.splitMs; slowestIdx = i; }
      });
    }

    lapsContainer.innerHTML = this.swLaps.map((lap, i) => {
      let cls = '';
      if (i === fastestIdx) cls = 'fastest';
      else if (i === slowestIdx) cls = 'slowest';
      return `<div class="alarm-sw-lap ${cls}">
        <span>Lap ${lap.lapNum}</span>
        <span>${formatMsSplit(lap.splitMs)}</span>
        <span>${formatMs(lap.totalMs)}</span>
      </div>`;
    }).join('');
  }

  private bindPomodoro(): void {
    this.content.querySelectorAll('[data-pom]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.pom!;
        if (action === 'start') {
          this.pomRunning = true;
          this.pomEndTime = Date.now() + this.pomRemaining * 1000;
          this.render(); // render → bindPomodoro → startPomodoroTick
        } else if (action === 'pause') {
          this.pomRunning = false;
          this.pomRemaining = Math.max(0, Math.round((this.pomEndTime - Date.now()) / 1000));
          this.render();
        } else if (action === 'reset') {
          this.pomRunning = false;
          this.pomPhase = 'focus';
          this.pomTotal = 25 * 60;
          this.pomRemaining = 25 * 60;
          this.render();
        } else if (action === 'skip') {
          this.pomRunning = false;
          this.advancePomodoro();
          this.render();
        }
      });
    });

    if (this.pomRunning) this.startPomodoroTick();
  }

  /** Targeted pomodoro tick - updates only SVG ring + time text (no DOM rebuild). */
  private startPomodoroTick(): void {
    if (this.pomInterval) clearInterval(this.pomInterval);
    this.pomInterval = setInterval(() => {
      this.pomRemaining = Math.max(0, Math.round((this.pomEndTime - Date.now()) / 1000));

      // Targeted DOM updates - avoid full re-render
      const ring = this.content.querySelector('.alarm-cd-ring');
      const timeText = this.content.querySelector('.alarm-cd-time');
      if (ring && timeText) {
        const pct = this.pomTotal > 0 ? ((this.pomTotal - this.pomRemaining) / this.pomTotal) * 100 : 0;
        const circumference = 2 * Math.PI * 60;
        const offset = circumference - (pct / 100) * circumference;
        ring.setAttribute('stroke-dashoffset', String(offset));
        const mm = Math.floor(this.pomRemaining / 60);
        const ss = this.pomRemaining % 60;
        timeText.textContent = `${padZ(mm)}:${padZ(ss)}`;
      }

      if (this.pomRemaining <= 0) {
        this.pomRunning = false;
        if (this.pomInterval) { clearInterval(this.pomInterval); this.pomInterval = null; }
        playBeep();
        this.advancePomodoro();
        this.render(); // Full re-render only on phase transition
      }
    }, 250);
  }

  private advancePomodoro(): void {
    if (this.pomPhase === 'focus') {
      this.pomSessions++;
      this.savePomSessions();
      // Long break every 4 sessions
      const breakMin = this.pomSessions % 4 === 0 ? 15 : 5;
      this.pomPhase = 'break';
      this.pomTotal = breakMin * 60;
      this.pomRemaining = breakMin * 60;
    } else {
      this.pomPhase = 'focus';
      this.pomTotal = 25 * 60;
      this.pomRemaining = 25 * 60;
    }
  }

  private bindWorld(): void {
    // Remove city
    this.content.querySelectorAll('.alarm-world-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const tz = (btn as HTMLElement).dataset.tz!;
        this.selectedCities = this.selectedCities.filter(c => c !== tz);
        this.saveCities();
        this.render();
      });
    });

    // Add city
    const select = this.content.querySelector('#worldCitySelect') as HTMLSelectElement | null;
    select?.addEventListener('change', () => {
      if (select.value) {
        this.selectedCities.push(select.value);
        this.saveCities();
        this.render();
      }
    });

    // Live update every second
    this.worldInterval = setInterval(() => {
      this.content.querySelectorAll('.alarm-world-card').forEach(card => {
        const tz = (card as HTMLElement).dataset.tz!;
        const info = getTimeInTz(tz);
        const timeEl = card.querySelector('.alarm-world-time');
        if (timeEl) timeEl.textContent = info.time;
        const iconEl = card.querySelector('.alarm-world-icon');
        if (iconEl) iconEl.textContent = info.hour >= 6 && info.hour < 18 ? '☀️' : '🌙';
      });
    }, 1000);
  }

  public override destroy(): void {
    this.clearAll();
    if (this.alarmCheckInterval) { clearInterval(this.alarmCheckInterval); this.alarmCheckInterval = null; }
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    // Flush any pending debounced alarm saves
    this.persistAlarmsNow();
    super.destroy();
  }

  public async update(): Promise<void> {
    // Offline-only
  }
}
