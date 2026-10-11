import { Panel } from './Panel';

// --- Types ---
interface StreakData {
  activeDays: string[];   // YYYY-MM-DD dates with activity
  lastCheck: string;      // ISO timestamp of last activity recording
}

interface StreakStats {
  streak: number;
  longestStreak: number;
  totalActiveDays: number;
  isActiveToday: boolean;
}

const STORAGE_KEY = 'hq-streak-data';
const MILESTONES = [3, 7, 14, 30, 60, 100, 365];
const MAX_DAYS = 400;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Validate streak data from localStorage - never trust raw JSON blindly. */
function validateStreakData(raw: unknown): StreakData {
  const defaults: StreakData = { activeDays: [], lastCheck: '' };
  if (!isObject(raw)) return defaults;
  const data = raw as Record<string, unknown>;
  const activeDays = Array.isArray(data.activeDays)
    ? (data.activeDays as unknown[])
        .filter((d): d is string => isString(d) && /^\d{4}-\d{2}-\d{2}$/.test(d))
        .slice(-MAX_DAYS)
    : [];
  return {
    activeDays,
    lastCheck: isString(data.lastCheck) ? data.lastCheck : '',
  };
}

function computeStats(data: StreakData): StreakStats {
  const todayStr = toDateStr(new Date());
  // Use Set for O(1) lookups instead of O(n) array.includes()
  const activeDaysSet = new Set(data.activeDays);
  const isActiveToday = activeDaysSet.has(todayStr);

  // Calculate current streak via date arithmetic with Set lookups
  let streak = 0;
  const checkDate = new Date();
  // If not active today, start checking from yesterday
  if (!isActiveToday) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  for (let i = 0; i < MAX_DAYS; i++) {
    const ds = toDateStr(checkDate);
    if (activeDaysSet.has(ds)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Calculate longest streak using sorted date list
  const sortedAsc = [...activeDaysSet].sort();
  let longestStreak = 0;
  let currentRun = 0;
  let prevDate: Date | null = null;
  for (const ds of sortedAsc) {
    const d = new Date(ds + 'T00:00:00');
    if (prevDate) {
      const diff = (d.getTime() - prevDate.getTime()) / 86400000;
      if (Math.abs(diff - 1) < 0.01) {
        currentRun++;
      } else {
        longestStreak = Math.max(longestStreak, currentRun);
        currentRun = 1;
      }
    } else {
      currentRun = 1;
    }
    prevDate = d;
  }
  longestStreak = Math.max(longestStreak, currentRun);

  return {
    streak,
    longestStreak,
    totalActiveDays: activeDaysSet.size,
    isActiveToday,
  };
}

function getStreakColor(streak: number): string {
  if (streak >= 30) return '#ef4444';
  if (streak >= 14) return '#f97316';
  if (streak >= 7) return '#eab308';
  if (streak >= 3) return '#84cc16';
  return '#a3a3a3';
}

function getNextMilestone(streak: number): number {
  for (const m of MILESTONES) {
    if (m > streak) return m;
  }
  return streak + 30;
}

function getMotivation(streak: number): string {
  if (streak >= 100) return 'Legendary! You\'re unstoppable!';
  if (streak >= 60) return 'Incredible dedication! Two months strong!';
  if (streak >= 30) return 'A whole month! You\'re on fire!';
  if (streak >= 14) return 'Two weeks running! Keep it up!';
  if (streak >= 7) return 'One week streak! Great consistency!';
  if (streak >= 3) return 'Nice streak building! Keep going!';
  if (streak >= 1) return 'Good start! Come back tomorrow!';
  return 'Start your streak today!';
}

export class ActivityStreakPanel extends Panel {
  private data: StreakData = { activeDays: [], lastCheck: '' };
  private boundVisibilityHandler: (() => void) | null = null;
  private lastRecordedDate: string = '';

  constructor() {
    super({ id: 'activity-streak', title: 'Activity Streak', className: 'streak-panel' });
    this.load();
    this.recordActivity();
    this.renderPanel();
    this.setupVisibilityHandler();
  }

  // --- Persistence ---
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.data = validateStreakData(JSON.parse(raw));
    } catch { /* ignore corrupt data */ }
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  /** Record today as active (called on construction and update). */
  private recordActivity(): void {
    const todayStr = toDateStr(new Date());
    if (!this.data.activeDays.includes(todayStr)) {
      this.data.activeDays.push(todayStr);
      // Keep only last MAX_DAYS days
      if (this.data.activeDays.length > MAX_DAYS) {
        this.data.activeDays = this.data.activeDays.slice(-MAX_DAYS);
      }
    }
    this.data.lastCheck = new Date().toISOString();
    this.lastRecordedDate = todayStr;
    this.save();
  }

  /** Re-check when tab becomes visible - handles midnight crossover. */
  private setupVisibilityHandler(): void {
    this.boundVisibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        const todayStr = toDateStr(new Date());
        if (todayStr !== this.lastRecordedDate) {
          this.recordActivity();
          this.renderPanel();
        }
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  // --- Render ---
  private renderPanel(): void {
    const stats = computeStats(this.data);
    const color = getStreakColor(stats.streak);
    const nextMilestone = getNextMilestone(stats.streak);
    const pct = Math.min(100, Math.round((stats.streak / nextMilestone) * 100));
    const motivation = getMotivation(stats.streak);

    // Build heatmap (last 12 weeks)
    const heatmap = this.buildHeatmap();

    this.setContent(`
      <div class="streak-container" style="cursor:pointer">
        <div class="streak-hero">
          <span class="streak-flame">🔥</span>
          <div class="streak-num" style="color:${color}">${stats.streak}</div>
          <div class="streak-label">day${stats.streak !== 1 ? 's' : ''} in a row</div>
        </div>

        <div class="streak-progress">
          <div class="streak-progress-bar">
            <div class="streak-progress-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <div class="streak-progress-label">${stats.streak} / ${nextMilestone} days</div>
        </div>

        <div class="streak-stats">
          <div class="streak-stat">
            <span class="streak-stat-icon">🏆</span>
            <span class="streak-stat-val">${stats.longestStreak}</span>
            <span class="streak-stat-label">Best</span>
          </div>
          <div class="streak-stat">
            <span class="streak-stat-icon">✨</span>
            <span class="streak-stat-val">${stats.totalActiveDays}</span>
            <span class="streak-stat-label">Total Days</span>
          </div>
          <div class="streak-stat">
            <span class="streak-stat-icon">⚡</span>
            <span class="streak-stat-val">${stats.isActiveToday ? '✓' : '-'}</span>
            <span class="streak-stat-label">Today</span>
          </div>
        </div>

        <div class="streak-motivation">${motivation}</div>

        <div class="streak-view-detail" style="text-align:center;margin:8px 0">
          <button class="streak-detail-btn" style="cursor:pointer;background:none;border:1px solid #333;border-radius:4px;color:#60a5fa;padding:4px 14px;font-size:12px">View Details</button>
        </div>

        <div class="streak-heatmap">
          <div class="streak-heatmap-label">Last 12 weeks</div>
          <div class="streak-heatmap-grid">${heatmap}</div>
        </div>
      </div>
    `);

    // Wire "View Details" button
    const detailBtn = this.content.querySelector('.streak-detail-btn');
    detailBtn?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: {
          type: 'event',
          data: {
            title: 'Activity Summary',
            category: 'social',
            description: `${motivation} Current streak: ${stats.streak} days. Best streak: ${stats.longestStreak} days. Total active days: ${stats.totalActiveDays}.`,
            value: stats.streak,
            unit: 'day streak',
          },
        },
      }));
    });
  }

  private buildHeatmap(): string {
    const today = new Date();
    const cells: string[] = [];
    const activeDaysSet = new Set(this.data.activeDays);

    // 12 weeks = 84 days
    for (let i = 83; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = toDateStr(d);
      const active = activeDaysSet.has(ds);
      const isToday = i === 0;
      cells.push(`<span class="streak-cell ${active ? 'active' : ''} ${isToday ? 'today' : ''}" title="${ds}"></span>`);
    }
    return cells.join('');
  }

  public override destroy(): void {
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    super.destroy();
  }

  public async update(): Promise<void> {
    this.recordActivity();
    this.renderPanel();
  }
}
