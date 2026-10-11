import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { debounce } from '@/utils/index';

// --- Types ---
type ViewMode = 'month' | 'agenda' | 'today' | 'year';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  date: string;       // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string;   // HH:MM
  color: string;
}

const STORAGE_KEY = 'hq-calendar-events';
const MAX_EVENTS = 200;
const SAVE_DEBOUNCE_MS = 400;
const EVENT_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f97316', '#a855f7', '#14b8a6'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const VIEW_LABELS: { key: ViewMode; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'today', label: 'Today' },
  { key: 'year', label: 'Year' },
];

/** Generate a collision-resistant unique ID. */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatTime12(t: string): string {
  const hVal = parseInt(t.split(':')[0] || '0', 10);
  const mVal = parseInt(t.split(':')[1] || '0', 10);
  const ampm = hVal >= 12 ? 'PM' : 'AM';
  const hr = hVal % 12 || 12;
  return `${hr}:${String(mVal).padStart(2, '0')} ${ampm}`;
}

function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
}

/** Validate a single event object from localStorage. */
function isValidEvent(v: unknown): v is CalendarEvent {
  if (!isObject(v)) return false;
  const e = v as Record<string, unknown>;
  return isString(e.id) && isString(e.title) && isString(e.date) && isString(e.color)
    && /^\d{4}-\d{2}-\d{2}$/.test(e.date as string);
}

/** Validate and sanitize loaded events array. */
function validateEvents(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(isValidEvent).slice(0, MAX_EVENTS);
}

export class CalendarPanel extends Panel {
  private events: CalendarEvent[] = [];
  private view: ViewMode = 'month';
  private currentDate = new Date();
  private addingDate: string | null = null;
  private readonly debouncedSave: () => void;
  private boundStorageHandler: ((e: StorageEvent) => void) | null = null;

  constructor() {
    super({ id: 'calendar', title: 'Calendar', className: 'calendar-panel', showCount: true });
    this.debouncedSave = debounce(() => this.persistNow(), SAVE_DEBOUNCE_MS);
    this.load();
    this.render();
    this.listenCrossTab();
  }

  // --- Persistence ---
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.events = validateEvents(JSON.parse(raw));
    } catch { /* ignore corrupt data */ }
  }

  private persistNow(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events.slice(0, MAX_EVENTS)));
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
          this.events = validateEvents(JSON.parse(e.newValue));
          this.render();
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', this.boundStorageHandler);
  }

  // --- Main Render ---
  private render(): void {
    this.setCount(this.events.length);
    const tabs = VIEW_LABELS.map(v =>
      `<button class="cal-tab ${this.view === v.key ? 'active' : ''}" data-view="${v.key}">${v.label}</button>`
    ).join('');

    let body = '';
    switch (this.view) {
      case 'month': body = this.renderMonth(); break;
      case 'agenda': body = this.renderAgenda(); break;
      case 'today': body = this.renderToday(); break;
      case 'year': body = this.renderYear(); break;
    }

    this.setContent(`
      <div class="cal-container">
        <div class="cal-tabs">${tabs}</div>
        ${body}
        ${this.addingDate ? this.renderAddForm() : ''}
      </div>
    `);
    this.bindTabs();
    this.bindView();
  }

  private bindTabs(): void {
    this.content.querySelectorAll('.cal-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.view = (btn as HTMLElement).dataset.view as ViewMode;
        this.addingDate = null;
        this.render();
      });
    });
  }

  // --- Month Grid ---
  private renderMonth(): string {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = mondayIndex(firstDay);
    const todayStr = toDateStr(new Date());

    const eventsByDay = new Map<string, CalendarEvent[]>();
    this.events.forEach(ev => {
      const list = eventsByDay.get(ev.date) || [];
      list.push(ev);
      eventsByDay.set(ev.date, list);
    });

    const cells: string[] = [];
    // Previous month filler
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, -startOffset + i + 1);
      cells.push(`<div class="cal-day cal-day-other" data-date="${toDateStr(d)}"><span class="cal-day-num">${d.getDate()}</span></div>`);
    }
    // Current month days
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayEvents = eventsByDay.get(dateStr) || [];
      const dots = dayEvents.slice(0, 3).map(ev => `<span class="cal-dot" style="background:${ev.color}"></span>`).join('');
      cells.push(`<div class="cal-day ${isToday ? 'cal-day-today' : ''}" data-date="${dateStr}">
        <span class="cal-day-num">${day}</span>
        <div class="cal-dots">${dots}</div>
      </div>`);
    }
    // Next month filler
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        const d = new Date(year, month + 1, i);
        cells.push(`<div class="cal-day cal-day-other" data-date="${toDateStr(d)}"><span class="cal-day-num">${d.getDate()}</span></div>`);
      }
    }

    return `
      <div class="cal-nav">
        <button class="cal-nav-btn" data-dir="-1">‹</button>
        <span class="cal-nav-title">${MONTH_NAMES[month]} ${year}</span>
        <button class="cal-nav-btn" data-dir="1">›</button>
      </div>
      <div class="cal-weekdays">${DAY_NAMES.map(d => `<span class="cal-weekday">${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    `;
  }

  // --- Agenda ---
  private renderAgenda(): string {
    const today = new Date();
    const upcoming = this.events
      .filter(ev => ev.date >= toDateStr(today))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));

    if (upcoming.length === 0) {
      return `<div class="cal-empty">No upcoming events</div>`;
    }

    // Group by date
    const groups = new Map<string, CalendarEvent[]>();
    upcoming.forEach(ev => {
      const list = groups.get(ev.date) || [];
      list.push(ev);
      groups.set(ev.date, list);
    });

    let html = '<div class="cal-agenda">';
    groups.forEach((evts, date) => {
      const d = new Date(date + 'T00:00:00');
      html += `<div class="cal-agenda-date">${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>`;
      evts.forEach(ev => {
        html += `<div class="cal-agenda-item" data-id="${ev.id}">
          <span class="cal-agenda-color" style="background:${ev.color}"></span>
          <div class="cal-agenda-info">
            <span class="cal-agenda-title">${escapeHtml(ev.title)}</span>
            ${ev.startTime ? `<span class="cal-agenda-time">${formatTime12(ev.startTime)}${ev.endTime ? ' - ' + formatTime12(ev.endTime) : ''}</span>` : ''}
            ${ev.description ? `<span class="cal-agenda-desc">${escapeHtml(ev.description)}</span>` : ''}
          </div>
          <button class="cal-del-btn" data-id="${ev.id}" title="Delete">×</button>
        </div>`;
      });
    });
    html += '</div>';
    return html;
  }

  // --- Today ---
  private renderToday(): string {
    const now = new Date();
    const todayStr = toDateStr(now);
    const todayEvents = this.events
      .filter(ev => ev.date === todayStr)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    return `
      <div class="cal-today-header">
        <div class="cal-today-num">${now.getDate()}</div>
        <div class="cal-today-info">
          <span class="cal-today-day">${now.toLocaleDateString('en-US', { weekday: 'long' })}</span>
          <span class="cal-today-monthyear">${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}</span>
        </div>
      </div>
      <div class="cal-today-events">
        ${todayEvents.length === 0 ? '<div class="cal-empty">No events today</div>' : ''}
        ${todayEvents.map(ev => `
          <div class="cal-today-event" data-id="${ev.id}">
            <span class="cal-agenda-color" style="background:${ev.color}"></span>
            <div class="cal-agenda-info">
              <span class="cal-agenda-title">${escapeHtml(ev.title)}</span>
              ${ev.startTime ? `<span class="cal-agenda-time">${formatTime12(ev.startTime)}${ev.endTime ? ' - ' + formatTime12(ev.endTime) : ''}</span>` : ''}
            </div>
            <button class="cal-del-btn" data-id="${ev.id}" title="Delete">×</button>
          </div>
        `).join('')}
      </div>
      <button class="cal-add-today-btn" data-date="${todayStr}">+ Add Event</button>
    `;
  }

  // --- Year Overview ---
  private renderYear(): string {
    const year = this.currentDate.getFullYear();
    const todayStr = toDateStr(new Date());
    const eventCounts = new Map<string, number>();
    this.events.forEach(ev => {
      eventCounts.set(ev.date, (eventCounts.get(ev.date) || 0) + 1);
    });

    let html = `<div class="cal-nav">
      <button class="cal-nav-btn" data-dir="-1">‹</button>
      <span class="cal-nav-title">${year}</span>
      <button class="cal-nav-btn" data-dir="1">›</button>
    </div><div class="cal-year-grid">`;

    for (let m = 0; m < 12; m++) {
      const monthName = MONTH_NAMES[m] ?? '';
      html += `<div class="cal-mini-month"><div class="cal-mini-title">${monthName.slice(0, 3)}</div><div class="cal-mini-days">`;
      const first = new Date(year, m, 1);
      const last = new Date(year, m + 1, 0);
      const offset = mondayIndex(first);
      for (let i = 0; i < offset; i++) html += '<span class="cal-mini-day empty"></span>';
      for (let d = 1; d <= last.getDate(); d++) {
        const ds = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const count = eventCounts.get(ds) || 0;
        const intensity = count === 0 ? 0 : count <= 1 ? 1 : count <= 2 ? 2 : count <= 4 ? 3 : 4;
        const isToday = ds === todayStr;
        html += `<span class="cal-mini-day lvl-${intensity} ${isToday ? 'today' : ''}" title="${count} event${count !== 1 ? 's' : ''}">${d}</span>`;
      }
      html += '</div></div>';
    }
    html += '</div>';
    return html;
  }

  // --- Add Event Form ---
  private renderAddForm(): string {
    return `<div class="cal-add-overlay">
      <div class="cal-add-form">
        <div class="cal-add-header">Add Event - ${this.addingDate}<button class="cal-add-close">×</button></div>
        <input class="cal-add-input" id="calTitle" placeholder="Event title" maxlength="100" />
        <input class="cal-add-input" id="calDesc" placeholder="Description (optional)" maxlength="200" />
        <div class="cal-add-row">
          <label>Start <input type="time" id="calStart" class="cal-time-input" /></label>
          <label>End <input type="time" id="calEnd" class="cal-time-input" /></label>
        </div>
        <div class="cal-add-colors">${EVENT_COLORS.map((c, i) =>
          `<button class="cal-color-btn ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background:${c}"></button>`
        ).join('')}</div>
        <div class="cal-add-actions">
          <button class="cal-save-btn">Save</button>
          <button class="cal-cancel-btn">Cancel</button>
        </div>
      </div>
    </div>`;
  }

  // --- Bindings ---
  private bindView(): void {
    // Navigation
    this.content.querySelectorAll('.cal-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = parseInt((btn as HTMLElement).dataset.dir || '0');
        if (this.view === 'year') {
          this.currentDate = new Date(this.currentDate.getFullYear() + dir, 0, 1);
        } else {
          this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + dir, 1);
        }
        this.render();
      });
    });

    // Day click → add event
    this.content.querySelectorAll('.cal-day:not(.cal-day-other)').forEach(cell => {
      cell.addEventListener('click', () => {
        this.addingDate = (cell as HTMLElement).dataset.date || null;
        this.render();
      });
    });

    // Today add button
    this.content.querySelector('.cal-add-today-btn')?.addEventListener('click', () => {
      this.addingDate = (this.content.querySelector('.cal-add-today-btn') as HTMLElement)?.dataset.date || toDateStr(new Date());
      this.render();
    });

    // Delete buttons
    this.content.querySelectorAll('.cal-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        this.events = this.events.filter(ev => ev.id !== id);
        this.save();
        this.render();
      });
    });

    // Add form bindings
    if (this.addingDate) {
      this.bindAddForm();
    }
  }

  private bindAddForm(): void {
    let selectedColor: string = EVENT_COLORS[0] || '#3b82f6';

    this.content.querySelector('.cal-add-close')?.addEventListener('click', () => {
      this.addingDate = null;
      this.render();
    });
    this.content.querySelector('.cal-cancel-btn')?.addEventListener('click', () => {
      this.addingDate = null;
      this.render();
    });

    this.content.querySelectorAll('.cal-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.content.querySelectorAll('.cal-color-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedColor = (btn as HTMLElement).dataset.color!;
      });
    });

    this.content.querySelector('.cal-save-btn')?.addEventListener('click', () => {
      this.submitAddForm(selectedColor);
    });

    // Enter key on title input submits the form
    this.content.querySelector('#calTitle')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        (e as KeyboardEvent).preventDefault();
        this.submitAddForm(selectedColor);
      }
    });
  }

  private submitAddForm(selectedColor: string): void {
    const title = (this.content.querySelector('#calTitle') as HTMLInputElement)?.value.trim();
    if (!title || !this.addingDate) return;
    const dateVal = this.addingDate;
    const desc = (this.content.querySelector('#calDesc') as HTMLInputElement)?.value.trim();
    const startTime = (this.content.querySelector('#calStart') as HTMLInputElement)?.value || undefined;
    const endTime = (this.content.querySelector('#calEnd') as HTMLInputElement)?.value || undefined;
    this.events.push({
      id: uid(),
      title,
      description: desc || undefined,
      date: dateVal,
      startTime,
      endTime,
      color: selectedColor || EVENT_COLORS[0] || '#3b82f6',
    });
    this.save();
    this.addingDate = null;
    this.render();
  }

  public override destroy(): void {
    this.flushSave();
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
