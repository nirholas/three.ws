import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { debounce } from '@/utils/index';

// --- Types ---
type ReminderStyle = 'list' | 'timeline' | 'matrix' | 'countdown' | 'planner';
type Priority = 'high' | 'medium' | 'low';
type FilterMode = 'all' | 'active' | 'completed';
type SortMode = 'dueDate' | 'priority' | 'createdAt';
type Quadrant = 'urgent-important' | 'not-urgent-important' | 'urgent-not-important' | 'not-urgent-not-important';

interface Reminder {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  dueDate: string;    // YYYY-MM-DD
  dueTime?: string;   // HH:MM
  createdAt: string;   // ISO
  quadrant?: Quadrant;
}

const STORAGE_KEY = 'hq-reminders-data';
const MAX_ITEMS = 100;
const SAVE_DEBOUNCE_MS = 400;
const COUNTDOWN_TICK_MS = 15_000; // 15-second targeted DOM updates instead of 60s full re-render
const STYLE_LABELS: { key: ReminderStyle; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'matrix', label: 'Matrix' },
  { key: 'countdown', label: 'Countdown' },
  { key: 'planner', label: 'Planner' },
];
const PRIORITY_COLORS: Record<Priority, string> = { high: '#ef4444', medium: '#eab308', low: '#3b82f6' };
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const QUADRANT_CONFIG: { key: Quadrant; label: string; color: string }[] = [
  { key: 'urgent-important', label: 'Urgent & Important', color: '#ef4444' },
  { key: 'not-urgent-important', label: 'Not Urgent & Important', color: '#3b82f6' },
  { key: 'urgent-not-important', label: 'Urgent & Not Important', color: '#f97316' },
  { key: 'not-urgent-not-important', label: 'Not Urgent & Not Important', color: '#6b7280' },
];

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

const VALID_PRIORITIES: Set<string> = new Set(['high', 'medium', 'low']);
const VALID_QUADRANTS: Set<string> = new Set([
  'urgent-important', 'not-urgent-important', 'urgent-not-important', 'not-urgent-not-important',
]);

/** Validate a single reminder from localStorage. */
function isValidReminder(v: unknown): v is Reminder {
  if (!isObject(v)) return false;
  const r = v as Record<string, unknown>;
  return isString(r.id) && isString(r.title)
    && typeof r.completed === 'boolean'
    && isString(r.priority) && VALID_PRIORITIES.has(r.priority as string)
    && isString(r.dueDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate as string)
    && isString(r.createdAt);
}

function validateReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(isValidReminder).slice(0, MAX_ITEMS).map(r => ({
    ...r,
    quadrant: isString(r.quadrant) && VALID_QUADRANTS.has(r.quadrant) ? r.quadrant as Quadrant : undefined,
    dueTime: isString(r.dueTime) ? r.dueTime : undefined,
  }));
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isOverdue(r: Reminder): boolean {
  if (r.completed) return false;
  const now = new Date();
  const dueStr = r.dueTime ? `${r.dueDate}T${r.dueTime}` : `${r.dueDate}T23:59:59`;
  return new Date(dueStr) < now;
}

function formatRelativeDate(dateStr: string): string {
  const today = toDateStr(new Date());
  const tomorrow = toDateStr(new Date(Date.now() + 86400000));
  const yesterday = toDateStr(new Date(Date.now() - 86400000));
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  if (dateStr === yesterday) return 'Yesterday';
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
  if (diff > 0 && diff <= 7) return `In ${diff} day${diff > 1 ? 's' : ''}`;
  if (diff < 0 && diff >= -7) return `${Math.abs(diff)} day${Math.abs(diff) > 1 ? 's' : ''} ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getCountdown(r: Reminder): string {
  const dueStr = r.dueTime ? `${r.dueDate}T${r.dueTime}` : `${r.dueDate}T23:59:59`;
  const diff = new Date(dueStr).getTime() - Date.now();
  if (diff <= 0) return 'Overdue';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${d}d ${h}h ${m}m`;
}

export class RemindersPanel extends Panel {
  private reminders: Reminder[] = [];
  private style: ReminderStyle = 'list';
  private filter: FilterMode = 'all';
  private sort: SortMode = 'dueDate';
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private addingQuadrant: Quadrant | null = null;
  private readonly debouncedSave: () => void;
  private boundStorageHandler: ((e: StorageEvent) => void) | null = null;

  constructor() {
    super({ id: 'reminders', title: 'Reminders', className: 'reminders-panel', showCount: true });
    this.debouncedSave = debounce(() => this.persistNow(), SAVE_DEBOUNCE_MS);
    this.load();
    this.render();
    this.listenCrossTab();
  }

  // --- Persistence ---
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.reminders = validateReminders(JSON.parse(raw));
    } catch { /* ignore corrupt data */ }
  }

  private persistNow(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.reminders.slice(0, MAX_ITEMS)));
  }

  private save(): void {
    this.debouncedSave();
  }

  private flushSave(): void {
    this.persistNow();
  }

  private listenCrossTab(): void {
    this.boundStorageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          this.reminders = validateReminders(JSON.parse(e.newValue));
          this.render();
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', this.boundStorageHandler);
  }

  private activeCount(): number {
    return this.reminders.filter(r => !r.completed).length;
  }

  private overdueCount(): number {
    return this.reminders.filter(r => isOverdue(r)).length;
  }

  // --- Main Render ---
  private render(): void {
    this.setCount(this.activeCount());
    this.clearCountdownInterval();

    const tabs = STYLE_LABELS.map(s =>
      `<button class="rem-tab ${this.style === s.key ? 'active' : ''}" data-style="${s.key}">${s.label}</button>`
    ).join('');

    const overdue = this.overdueCount();
    const badge = overdue > 0 ? `<span class="rem-overdue-badge">${overdue}</span>` : '';

    let body = '';
    switch (this.style) {
      case 'list': body = this.renderList(); break;
      case 'timeline': body = this.renderTimeline(); break;
      case 'matrix': body = this.renderMatrix(); break;
      case 'countdown': body = this.renderCountdown(); break;
      case 'planner': body = this.renderPlanner(); break;
    }

    this.setContent(`
      <div class="rem-container">
        <div class="rem-header-bar">${badge}</div>
        <div class="rem-tabs">${tabs}</div>
        <div class="rem-body">${body}</div>
        ${this.addingQuadrant !== null || this.style === 'list' || this.style === 'planner' ? this.renderAddForm() : ''}
      </div>
    `);
    this.bindTabs();
    this.bindView();
  }

  private clearCountdownInterval(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private bindTabs(): void {
    this.content.querySelectorAll('.rem-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.style = (btn as HTMLElement).dataset.style as ReminderStyle;
        this.addingQuadrant = null;
        this.render();
      });
    });
  }

  // --- List View ---
  private renderList(): string {
    let filtered = [...this.reminders];
    if (this.filter === 'active') filtered = filtered.filter(r => !r.completed);
    if (this.filter === 'completed') filtered = filtered.filter(r => r.completed);

    // Sort
    filtered.sort((a, b) => {
      if (this.sort === 'dueDate') return a.dueDate.localeCompare(b.dueDate);
      if (this.sort === 'priority') return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return a.createdAt.localeCompare(b.createdAt);
    });

    const filters: FilterMode[] = ['all', 'active', 'completed'];
    const sorts: { key: SortMode; label: string }[] = [
      { key: 'dueDate', label: 'Due' },
      { key: 'priority', label: 'Priority' },
      { key: 'createdAt', label: 'Created' },
    ];

    const completedCount = this.reminders.filter(r => r.completed).length;

    return `
      <div class="rem-list-controls">
        <div class="rem-filters">${filters.map(f =>
          `<button class="rem-filter-btn ${this.filter === f ? 'active' : ''}" data-filter="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</button>`
        ).join('')}</div>
        <div class="rem-sorts">${sorts.map(s =>
          `<button class="rem-sort-btn ${this.sort === s.key ? 'active' : ''}" data-sort="${s.key}">${s.label}</button>`
        ).join('')}</div>
      </div>
      <div class="rem-list">
        ${filtered.length === 0 ? '<div class="rem-empty">No reminders</div>' : ''}
        ${filtered.map(r => this.renderItem(r)).join('')}
      </div>
      ${completedCount > 0 ? `<button class="rem-clear-btn">Clear completed (${completedCount})</button>` : ''}
    `;
  }

  private renderItem(r: Reminder): string {
    const overdue = isOverdue(r);
    return `<div class="rem-item ${r.completed ? 'completed' : ''} ${overdue ? 'overdue' : ''}" data-id="${r.id}">
      <button class="rem-toggle" data-id="${r.id}">${r.completed ? '✓' : '○'}</button>
      <div class="rem-item-info">
        <span class="rem-item-title">${escapeHtml(r.title)}</span>
        <span class="rem-item-meta">
          <span class="rem-priority-tag" style="color:${PRIORITY_COLORS[r.priority]}">${r.priority}</span>
          <span class="rem-date">${formatRelativeDate(r.dueDate)}</span>
        </span>
      </div>
      <button class="rem-del" data-id="${r.id}" title="Delete">×</button>
    </div>`;
  }

  // --- Timeline View ---
  private renderTimeline(): string {
    const overdue = this.reminders.filter(r => isOverdue(r));
    const todayStr = toDateStr(new Date());
    const todayItems = this.reminders.filter(r => !r.completed && r.dueDate === todayStr && !isOverdue(r));
    const upcoming = this.reminders.filter(r => !r.completed && r.dueDate > todayStr);
    const completed = this.reminders.filter(r => r.completed);

    const sections: { label: string; items: Reminder[]; color: string }[] = [
      { label: 'Overdue', items: overdue, color: '#ef4444' },
      { label: 'Today', items: todayItems, color: '#eab308' },
      { label: 'Upcoming', items: upcoming, color: '#22c55e' },
      { label: 'Completed', items: completed, color: '#6b7280' },
    ];

    return `<div class="rem-timeline">${sections.filter(s => s.items.length > 0).map(s => `
      <div class="rem-tl-section">
        <div class="rem-tl-header" style="color:${s.color}">${s.label} <span class="rem-tl-count">${s.items.length}</span></div>
        <div class="rem-tl-items">
          ${s.items.map(r => `<div class="rem-tl-item" data-id="${r.id}">
            <span class="rem-tl-dot" style="background:${s.color}"></span>
            <div class="rem-tl-content">
              <button class="rem-toggle sm" data-id="${r.id}">${r.completed ? '✓' : '○'}</button>
              <span class="rem-tl-title ${r.completed ? 'done' : ''}">${escapeHtml(r.title)}</span>
              <span class="rem-tl-date">${formatRelativeDate(r.dueDate)}</span>
            </div>
            <button class="rem-del" data-id="${r.id}" title="Delete">×</button>
          </div>`).join('')}
        </div>
      </div>
    `).join('')}</div>`;
  }

  // --- Eisenhower Matrix ---
  private renderMatrix(): string {
    return `<div class="rem-matrix">${QUADRANT_CONFIG.map(q => {
      const items = this.reminders.filter(r => (r.quadrant || 'urgent-important') === q.key && !r.completed);
      return `<div class="rem-matrix-quad" data-quad="${q.key}" style="border-color:${q.color}">
        <div class="rem-matrix-label" style="color:${q.color}">${q.label} <span class="rem-matrix-count">${items.length}</span></div>
        <div class="rem-matrix-items">
          ${items.map(r => `<div class="rem-matrix-item" data-id="${r.id}">
            <button class="rem-toggle sm" data-id="${r.id}">○</button>
            <span>${escapeHtml(r.title)}</span>
            <button class="rem-del sm" data-id="${r.id}">×</button>
          </div>`).join('')}
        </div>
        <button class="rem-matrix-add" data-quad="${q.key}">+ Add</button>
      </div>`;
    }).join('')}</div>`;
  }

  // --- Countdown ---
  private renderCountdown(): string {
    const active = this.reminders.filter(r => !r.completed).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const done = this.reminders.filter(r => r.completed);
    const all = [...active, ...done];

    return `<div class="rem-countdown-cards">
      ${all.length === 0 ? '<div class="rem-empty">No reminders</div>' : ''}
      ${all.map(r => {
        const overdue = isOverdue(r);
        const cd = r.completed ? 'Done' : getCountdown(r);
        return `<div class="rem-cd-card ${r.completed ? 'completed' : ''} ${overdue ? 'overdue-pulse' : ''}" data-id="${r.id}"
                     style="border-left: 3px solid ${PRIORITY_COLORS[r.priority]}">
          <div class="rem-cd-top">
            <button class="rem-toggle" data-id="${r.id}">${r.completed ? '✓' : '○'}</button>
            <span class="rem-cd-title">${escapeHtml(r.title)}</span>
            <button class="rem-del" data-id="${r.id}">×</button>
          </div>
          <div class="rem-cd-time ${overdue ? 'overdue' : ''}">${cd}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // --- Daily Planner ---
  private renderPlanner(): string {
    const todayStr = toDateStr(new Date());
    const nowHour = new Date().getHours();
    const slots: string[] = [];
    for (let h = 6; h <= 23; h++) {
      const hStr = String(h).padStart(2, '0');
      const items = this.reminders.filter(r => r.dueDate === todayStr && r.dueTime?.startsWith(hStr));
      const isPast = h < nowHour;
      const isCurrent = h === nowHour;
      slots.push(`<div class="rem-planner-slot ${isPast ? 'past' : ''} ${isCurrent ? 'current' : ''}" data-hour="${hStr}">
        <span class="rem-planner-hour">${h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}</span>
        <div class="rem-planner-items">
          ${items.map(r => `<div class="rem-planner-item ${r.completed ? 'completed' : ''}" data-id="${r.id}">
            <button class="rem-toggle sm" data-id="${r.id}">${r.completed ? '✓' : '○'}</button>
            <span>${escapeHtml(r.title)}</span>
            <button class="rem-del sm" data-id="${r.id}">×</button>
          </div>`).join('')}
        </div>
      </div>`);
    }
    return `<div class="rem-planner"><div class="rem-planner-label">Today's Schedule</div>${slots.join('')}</div>`;
  }

  // --- Add Form ---
  private renderAddForm(): string {
    const today = toDateStr(new Date());
    return `<div class="rem-add-form">
      <div class="rem-add-row">
        <input class="rem-add-input" id="remTitle" placeholder="New reminder…" maxlength="150" />
        <input type="date" class="rem-add-date" id="remDate" value="${today}" />
      </div>
      <div class="rem-add-row">
        <input type="time" class="rem-add-time" id="remTime" />
        <select class="rem-add-priority" id="remPriority">
          <option value="high">🔴 High</option>
          <option value="medium" selected>🟡 Medium</option>
          <option value="low">🔵 Low</option>
        </select>
        <button class="rem-add-btn">Add</button>
      </div>
    </div>`;
  }

  // --- Bindings ---
  private bindView(): void {
    // Filter & sort (list view)
    this.content.querySelectorAll('.rem-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = (btn as HTMLElement).dataset.filter as FilterMode;
        this.render();
      });
    });
    this.content.querySelectorAll('.rem-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sort = (btn as HTMLElement).dataset.sort as SortMode;
        this.render();
      });
    });

    // Toggle complete
    this.content.querySelectorAll('.rem-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const r = this.reminders.find(x => x.id === id);
        if (r) { r.completed = !r.completed; this.save(); this.render(); }
      });
    });

    // Delete
    this.content.querySelectorAll('.rem-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        this.reminders = this.reminders.filter(r => r.id !== id);
        this.save();
        this.render();
      });
    });

    // Clear completed
    this.content.querySelector('.rem-clear-btn')?.addEventListener('click', () => {
      this.reminders = this.reminders.filter(r => !r.completed);
      this.save();
      this.render();
    });

    // Matrix add
    this.content.querySelectorAll('.rem-matrix-add').forEach(btn => {
      btn.addEventListener('click', () => {
        this.addingQuadrant = (btn as HTMLElement).dataset.quad as Quadrant;
        this.render();
      });
    });

    // Add form
    const addBtn = this.content.querySelector('.rem-add-btn');
    const titleInput = this.content.querySelector('#remTitle') as HTMLInputElement | null;
    if (addBtn && titleInput) {
      const doAdd = () => {
        const title = titleInput.value.trim();
        if (!title) return;
        const date = (this.content.querySelector('#remDate') as HTMLInputElement)?.value || toDateStr(new Date());
        const time = (this.content.querySelector('#remTime') as HTMLInputElement)?.value || undefined;
        const priority = (this.content.querySelector('#remPriority') as HTMLSelectElement)?.value as Priority || 'medium';
        this.reminders.push({
          id: uid(),
          title,
          completed: false,
          priority,
          dueDate: date,
          dueTime: time,
          createdAt: new Date().toISOString(),
          quadrant: this.addingQuadrant || undefined,
        });
        this.addingQuadrant = null;
        this.save();
        this.render();
      };
      addBtn.addEventListener('click', doAdd);
      titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    }

    // Countdown targeted DOM updates (no full re-render)
    if (this.style === 'countdown') {
      this.countdownInterval = setInterval(() => {
        this.content.querySelectorAll('.rem-cd-card:not(.completed)').forEach(card => {
          const id = (card as HTMLElement).dataset.id;
          const r = this.reminders.find(x => x.id === id);
          if (!r) return;
          const timeEl = card.querySelector('.rem-cd-time');
          if (timeEl) {
            const overdue = isOverdue(r);
            timeEl.textContent = getCountdown(r);
            timeEl.classList.toggle('overdue', overdue);
            card.classList.toggle('overdue-pulse', overdue);
          }
        });
      }, COUNTDOWN_TICK_MS);
    }
  }

  public override destroy(): void {
    this.flushSave();
    this.clearCountdownInterval();
    if (this.boundStorageHandler) {
      window.removeEventListener('storage', this.boundStorageHandler);
      this.boundStorageHandler = null;
    }
    super.destroy();
  }

  public async update(): Promise<void> {
    // Offline-only
  }
}
