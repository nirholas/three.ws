import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { debounce } from '@/utils/index';

// --- Types ---
type NoteStyle = 'sticky' | 'lined' | 'markdown' | 'checklist' | 'kanban' | 'cornell';

interface StickyNote {
  id: string;
  text: string;
  color: number;
}

interface KanbanCard {
  id: string;
  text: string;
  createdAt: string;
}

interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

interface CornellData {
  cues: string;
  notes: string;
  summary: string;
}

interface NotesData {
  sticky: StickyNote[];
  lined: string;
  markdown: string;
  checklist: ChecklistItem[];
  kanban: { todo: KanbanCard[]; inProgress: KanbanCard[]; done: KanbanCard[] };
  cornell: CornellData;
}

const STORAGE_KEY = 'hq-notes-data';
const MAX_ITEMS = 50;
const SAVE_DEBOUNCE_MS = 400;
const STICKY_COLORS = ['#fbbf24', '#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fb923c'];
const STYLE_LABELS: { key: NoteStyle; label: string }[] = [
  { key: 'sticky', label: 'Sticky' },
  { key: 'lined', label: 'Lined' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'cornell', label: 'Cornell' },
];

/** Generate a collision-resistant unique ID (timestamp + 12 chars random). */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function defaultData(): NotesData {
  return {
    sticky: [],
    lined: '',
    markdown: '',
    checklist: [],
    kanban: { todo: [], inProgress: [], done: [] },
    cornell: { cues: '', notes: '', summary: '' },
  };
}

/** Validate and sanitize loaded data - never trust localStorage blindly. */
function validateData(raw: unknown): NotesData {
  const defaults = defaultData();
  if (!isObject(raw)) return defaults;

  const data = raw as Record<string, unknown>;

  // Validate sticky notes
  const sticky = Array.isArray(data.sticky)
    ? (data.sticky as unknown[]).filter((n): n is StickyNote =>
        isObject(n) && isString((n as Record<string, unknown>).id) && isString((n as Record<string, unknown>).text) && typeof (n as Record<string, unknown>).color === 'number'
      ).slice(0, MAX_ITEMS)
    : defaults.sticky;

  // Validate checklist
  const checklist = Array.isArray(data.checklist)
    ? (data.checklist as unknown[]).filter((c): c is ChecklistItem =>
        isObject(c) && isString((c as Record<string, unknown>).id) && isString((c as Record<string, unknown>).text) && typeof (c as Record<string, unknown>).checked === 'boolean'
      ).slice(0, MAX_ITEMS)
    : defaults.checklist;

  // Validate kanban
  const validateCards = (arr: unknown): KanbanCard[] =>
    Array.isArray(arr)
      ? (arr as unknown[]).filter((c): c is KanbanCard =>
          isObject(c) && isString((c as Record<string, unknown>).id) && isString((c as Record<string, unknown>).text) && isString((c as Record<string, unknown>).createdAt)
        ).slice(0, MAX_ITEMS)
      : [];
  const kanbanRaw = isObject(data.kanban) ? data.kanban as Record<string, unknown> : {};
  const kanban = {
    todo: validateCards(kanbanRaw.todo),
    inProgress: validateCards(kanbanRaw.inProgress),
    done: validateCards(kanbanRaw.done),
  };

  // Validate cornell
  const cornellRaw = isObject(data.cornell) ? data.cornell as Record<string, unknown> : {};
  const cornell: CornellData = {
    cues: isString(cornellRaw.cues) ? String(cornellRaw.cues) : '',
    notes: isString(cornellRaw.notes) ? String(cornellRaw.notes) : '',
    summary: isString(cornellRaw.summary) ? String(cornellRaw.summary) : '',
  };

  return {
    sticky,
    lined: isString(data.lined) ? String(data.lined) : defaults.lined,
    markdown: isString(data.markdown) ? String(data.markdown) : defaults.markdown,
    checklist,
    kanban,
    cornell,
  };
}

export class NotesPanel extends Panel {
  private data: NotesData = defaultData();
  private style: NoteStyle = 'sticky';
  private mdPreview = false;
  private readonly debouncedSave: () => void;
  private boundStorageHandler: ((e: StorageEvent) => void) | null = null;

  constructor() {
    super({ id: 'notes', title: 'Notes', className: 'notes-panel', showCount: true });
    this.debouncedSave = debounce(() => this.persistNow(), SAVE_DEBOUNCE_MS);
    this.load();
    this.render();
    this.listenCrossTab();
  }

  // --- Persistence ---
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.data = validateData(JSON.parse(raw));
    } catch { /* ignore corrupt data - fall back to defaults */ }
  }

  /** Flush data to localStorage immediately (called by debounced wrapper). */
  private persistNow(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  /** Queue a debounced save - safe to call on every keystroke. */
  private save(): void {
    this.debouncedSave();
  }

  /** Flush pending saves immediately (used before destroy). */
  private flushSave(): void {
    this.persistNow();
  }

  /** Listen for cross-tab localStorage changes. */
  private listenCrossTab(): void {
    this.boundStorageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          this.data = validateData(JSON.parse(e.newValue));
          this.render();
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', this.boundStorageHandler);
  }

  private getItemCount(): number {
    switch (this.style) {
      case 'sticky': return this.data.sticky.length;
      case 'checklist': return this.data.checklist.length;
      case 'kanban': return this.data.kanban.todo.length + this.data.kanban.inProgress.length + this.data.kanban.done.length;
      default: return 0;
    }
  }

  // --- Main Render ---
  private render(): void {
    this.setCount(this.getItemCount());
    const tabs = STYLE_LABELS.map(s =>
      `<button class="notes-tab ${this.style === s.key ? 'active' : ''}" data-style="${s.key}">${s.label}</button>`
    ).join('');

    let body = '';
    switch (this.style) {
      case 'sticky': body = this.renderSticky(); break;
      case 'lined': body = this.renderLined(); break;
      case 'markdown': body = this.renderMarkdown(); break;
      case 'checklist': body = this.renderChecklist(); break;
      case 'kanban': body = this.renderKanban(); break;
      case 'cornell': body = this.renderCornell(); break;
    }

    this.setContent(`
      <div class="notes-container">
        <div class="notes-tabs">${tabs}</div>
        <div class="notes-body">${body}</div>
      </div>
    `);
    this.bindTabs();
    this.bindView();
  }

  private bindTabs(): void {
    this.content.querySelectorAll('.notes-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.style = (btn as HTMLElement).dataset.style as NoteStyle;
        this.render();
      });
    });
  }

  // --- Sticky Notes ---
  private renderSticky(): string {
    const notes = this.data.sticky.map(n => {
      const bg = STICKY_COLORS[n.color % STICKY_COLORS.length];
      return `<div class="notes-sticky" data-id="${n.id}" style="background:${bg}">
        <textarea class="notes-sticky-text" data-id="${n.id}">${escapeHtml(n.text)}</textarea>
        <button class="notes-sticky-del" data-id="${n.id}" title="Delete">×</button>
      </div>`;
    }).join('');
    return `<div class="notes-sticky-grid">${notes}
      <button class="notes-sticky-add" title="Add sticky note">+ Add Note</button>
    </div>`;
  }

  // --- Lined Notepad ---
  private renderLined(): string {
    return `<div class="notes-lined-wrap">
      <textarea class="notes-lined-textarea" placeholder="Start typing…">${escapeHtml(this.data.lined)}</textarea>
    </div>`;
  }

  // --- Markdown ---
  private renderMarkdown(): string {
    const toggle = `<div class="notes-md-toggle">
      <button class="notes-tab ${!this.mdPreview ? 'active' : ''}" data-md="edit">Edit</button>
      <button class="notes-tab ${this.mdPreview ? 'active' : ''}" data-md="preview">Preview</button>
    </div>`;
    if (this.mdPreview) {
      return toggle + `<div class="notes-md-preview">${this.renderMarkdownText(this.data.markdown)}</div>`;
    }
    return toggle + `<textarea class="notes-md-editor" placeholder="Write markdown…">${escapeHtml(this.data.markdown)}</textarea>`;
  }

  private renderMarkdownText(text: string): string {
    if (!text) return '<span class="notes-empty">Nothing to preview</span>';
    let html = escapeHtml(text);
    // Code blocks (must come before inline patterns)
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="notes-code-block">$1</pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // Bold & italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Lists - group consecutive <li> items into <ul> blocks correctly
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    // Line breaks (but not inside <pre> blocks or already-converted tags)
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // --- Checklist ---
  private renderChecklist(): string {
    const checked = this.data.checklist.filter(c => c.checked).length;
    const total = this.data.checklist.length;
    const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
    const items = this.data.checklist.map((item, i) => `
      <div class="notes-check-item ${item.checked ? 'checked' : ''}" data-id="${item.id}">
        <button class="notes-check-box" data-action="toggle" data-id="${item.id}">${item.checked ? '☑' : '☐'}</button>
        <span class="notes-check-text">${escapeHtml(item.text)}</span>
        <div class="notes-check-actions">
          ${i > 0 ? `<button class="notes-check-btn" data-action="up" data-id="${item.id}" title="Move up">↑</button>` : ''}
          ${i < this.data.checklist.length - 1 ? `<button class="notes-check-btn" data-action="down" data-id="${item.id}" title="Move down">↓</button>` : ''}
          <button class="notes-check-btn del" data-action="del" data-id="${item.id}" title="Delete">×</button>
        </div>
      </div>
    `).join('');
    return `<div class="notes-checklist">
      <div class="notes-check-progress">
        <div class="notes-check-bar"><div class="notes-check-fill" style="width:${pct}%"></div></div>
        <span class="notes-check-count">${checked}/${total}</span>
      </div>
      <div class="notes-check-input-row">
        <input class="notes-check-input" type="text" placeholder="Add item…" maxlength="200" />
        <button class="notes-check-add">+</button>
      </div>
      ${items}
    </div>`;
  }

  // --- Kanban ---
  private renderKanban(): string {
    const cols: { key: 'todo' | 'inProgress' | 'done'; label: string }[] = [
      { key: 'todo', label: 'To Do' },
      { key: 'inProgress', label: 'In Progress' },
      { key: 'done', label: 'Done' },
    ];
    return `<div class="notes-kanban">${cols.map(col => `
      <div class="notes-kanban-col" data-col="${col.key}">
        <div class="notes-kanban-header">${col.label} <span class="notes-kanban-count">${this.data.kanban[col.key].length}</span></div>
        <div class="notes-kanban-cards">
          ${this.data.kanban[col.key].map(card => `
            <div class="notes-kanban-card" data-id="${card.id}" data-col="${col.key}">
              <div class="notes-kanban-card-text">${escapeHtml(card.text)}</div>
              <div class="notes-kanban-card-footer">
                <span class="notes-kanban-card-time">${new Date(card.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <div class="notes-kanban-card-actions">
                  ${col.key !== 'todo' ? `<button class="notes-kanban-btn" data-action="left" data-id="${card.id}" data-col="${col.key}" title="Move left">←</button>` : ''}
                  ${col.key !== 'done' ? `<button class="notes-kanban-btn" data-action="right" data-id="${card.id}" data-col="${col.key}" title="Move right">→</button>` : ''}
                  <button class="notes-kanban-btn del" data-action="del" data-id="${card.id}" data-col="${col.key}" title="Delete">×</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="notes-kanban-add-row">
          <input class="notes-kanban-input" data-col="${col.key}" placeholder="Add card…" maxlength="200" />
          <button class="notes-kanban-add-btn" data-col="${col.key}">+</button>
        </div>
      </div>
    `).join('')}</div>`;
  }

  // --- Cornell ---
  private renderCornell(): string {
    return `<div class="notes-cornell">
      <div class="notes-cornell-top">
        <div class="notes-cornell-cues">
          <div class="notes-cornell-label">Cues / Questions</div>
          <textarea class="notes-cornell-area" data-field="cues" placeholder="Key questions, cues…">${escapeHtml(this.data.cornell.cues)}</textarea>
        </div>
        <div class="notes-cornell-notes">
          <div class="notes-cornell-label">Notes</div>
          <textarea class="notes-cornell-area" data-field="notes" placeholder="Detailed notes…">${escapeHtml(this.data.cornell.notes)}</textarea>
        </div>
      </div>
      <div class="notes-cornell-summary">
        <div class="notes-cornell-label">Summary</div>
        <textarea class="notes-cornell-area" data-field="summary" placeholder="Summary…">${escapeHtml(this.data.cornell.summary)}</textarea>
      </div>
    </div>`;
  }

  // --- Event Binding per View ---
  private bindView(): void {
    switch (this.style) {
      case 'sticky': this.bindSticky(); break;
      case 'lined': this.bindLined(); break;
      case 'markdown': this.bindMarkdown(); break;
      case 'checklist': this.bindChecklist(); break;
      case 'kanban': this.bindKanban(); break;
      case 'cornell': this.bindCornell(); break;
    }
  }

  private bindSticky(): void {
    // Add note
    this.content.querySelector('.notes-sticky-add')?.addEventListener('click', () => {
      if (this.data.sticky.length >= MAX_ITEMS) return;
      this.data.sticky.push({ id: uid(), text: '', color: this.data.sticky.length % STICKY_COLORS.length });
      this.save();
      this.render();
    });
    // Delete
    this.content.querySelectorAll('.notes-sticky-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.data.sticky = this.data.sticky.filter(n => n.id !== id);
        this.save();
        this.render();
      });
    });
    // Edit text
    this.content.querySelectorAll<HTMLTextAreaElement>('.notes-sticky-text').forEach(ta => {
      ta.addEventListener('input', () => {
        const note = this.data.sticky.find(n => n.id === ta.dataset.id);
        if (note) { note.text = ta.value; this.save(); }
      });
    });
  }

  private bindLined(): void {
    const ta = this.content.querySelector<HTMLTextAreaElement>('.notes-lined-textarea');
    ta?.addEventListener('input', () => {
      this.data.lined = ta.value;
      this.save();
    });
  }

  private bindMarkdown(): void {
    // Toggle
    this.content.querySelectorAll('[data-md]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mdPreview = (btn as HTMLElement).dataset.md === 'preview';
        this.render();
      });
    });
    // Editor
    const ta = this.content.querySelector<HTMLTextAreaElement>('.notes-md-editor');
    ta?.addEventListener('input', () => {
      this.data.markdown = ta.value;
      this.save();
    });
  }

  private bindChecklist(): void {
    const input = this.content.querySelector<HTMLInputElement>('.notes-check-input');
    const addBtn = this.content.querySelector('.notes-check-add');
    const addItem = () => {
      if (!input || !input.value.trim() || this.data.checklist.length >= MAX_ITEMS) return;
      this.data.checklist.push({ id: uid(), text: input.value.trim(), checked: false });
      this.save();
      this.render();
    };
    addBtn?.addEventListener('click', addItem);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });

    this.content.querySelectorAll('.notes-check-btn, .notes-check-box').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement;
        const id = el.dataset.id!;
        const action = el.dataset.action!;
        const idx = this.data.checklist.findIndex(c => c.id === id);
        if (idx < 0) return;
        const item = this.data.checklist[idx];
        if (!item) return;
        if (action === 'toggle') {
          item.checked = !item.checked;
        } else if (action === 'del') {
          this.data.checklist.splice(idx, 1);
        } else if (action === 'up' && idx > 0) {
          const prev = this.data.checklist[idx - 1];
          if (prev) { this.data.checklist[idx - 1] = item; this.data.checklist[idx] = prev; }
        } else if (action === 'down' && idx < this.data.checklist.length - 1) {
          const next = this.data.checklist[idx + 1];
          if (next) { this.data.checklist[idx] = next; this.data.checklist[idx + 1] = item; }
        }
        this.save();
        this.render();
      });
    });
  }

  private bindKanban(): void {
    const colOrder: ('todo' | 'inProgress' | 'done')[] = ['todo', 'inProgress', 'done'];

    // Add card
    this.content.querySelectorAll('.notes-kanban-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = (btn as HTMLElement).dataset.col as 'todo' | 'inProgress' | 'done';
        const input = this.content.querySelector<HTMLInputElement>(`.notes-kanban-input[data-col="${col}"]`);
        if (!input || !input.value.trim()) return;
        const total = this.data.kanban.todo.length + this.data.kanban.inProgress.length + this.data.kanban.done.length;
        if (total >= MAX_ITEMS) return;
        this.data.kanban[col].push({ id: uid(), text: input.value.trim(), createdAt: new Date().toISOString() });
        this.save();
        this.render();
      });
    });

    // Card actions
    this.content.querySelectorAll('.notes-kanban-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement;
        const id = el.dataset.id!;
        const col = el.dataset.col as 'todo' | 'inProgress' | 'done';
        const action = el.dataset.action!;
        if (action === 'del') {
          this.data.kanban[col] = this.data.kanban[col].filter(c => c.id !== id);
        } else {
          const ci = colOrder.indexOf(col);
          const targetCol = action === 'left' ? colOrder[ci - 1] : colOrder[ci + 1];
          if (!targetCol) return;
          const card = this.data.kanban[col].find(c => c.id === id);
          if (!card) return;
          this.data.kanban[col] = this.data.kanban[col].filter(c => c.id !== id);
          this.data.kanban[targetCol].push(card);
        }
        this.save();
        this.render();
      });
    });

    // Enter to add
    this.content.querySelectorAll<HTMLInputElement>('.notes-kanban-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const col = input.dataset.col as 'todo' | 'inProgress' | 'done';
          this.content.querySelector<HTMLButtonElement>(`.notes-kanban-add-btn[data-col="${col}"]`)?.click();
        }
      });
    });
  }

  private bindCornell(): void {
    this.content.querySelectorAll<HTMLTextAreaElement>('.notes-cornell-area').forEach(ta => {
      ta.addEventListener('input', () => {
        const field = ta.dataset.field as 'cues' | 'notes' | 'summary';
        this.data.cornell[field] = ta.value;
        this.save();
      });
    });
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
    // Offline-only - no external data
  }
}
