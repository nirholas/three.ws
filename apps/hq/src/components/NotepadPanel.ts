import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

const NOTES_KEY = 'hq-notepad';
const MAX_NOTES = 100;
const MAX_NOTE_LENGTH = 2000;

interface Note {
  id: string;
  text: string;
  ts: number;
  pinned?: boolean;
  color?: string;
}

/** Allowed note accent colors - prevents CSS injection */
const ALLOWED_COLORS = ['#22c55e', '#eab308', '#ef4444', '#3b82f6', '#a855f7'] as const;

function isAllowedColor(c: string | undefined): c is string {
  return typeof c === 'string' && (ALLOWED_COLORS as readonly string[]).includes(c);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export class NotepadPanel extends Panel {
  private notes: Note[] = [];

  constructor() {
    super({ id: 'notepad', title: 'Notepad', className: 'notepad-panel' });
    this.loadNotes();
    this.renderNotepad();
  }

  private loadNotes(): void {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) { this.notes = []; return; }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { this.notes = []; return; }
      // Validate and sanitize stored notes
      this.notes = parsed
        .filter((n: unknown): n is Note =>
          typeof n === 'object' && n !== null &&
          typeof (n as Note).id === 'string' &&
          typeof (n as Note).text === 'string' &&
          typeof (n as Note).ts === 'number'
        )
        .map((n: Note) => ({
          ...n,
          text: n.text.slice(0, MAX_NOTE_LENGTH),
          color: isAllowedColor(n.color) ? n.color : undefined,
        }))
        .slice(0, MAX_NOTES);
    } catch {
      this.notes = [];
    }
  }

  private saveNotes(): void {
    localStorage.setItem(NOTES_KEY, JSON.stringify(this.notes.slice(0, MAX_NOTES)));
  }

  private renderNotepad(): void {
    const sortedNotes = [...this.notes].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.ts - a.ts;
    });

    this.content.innerHTML = `
      <div class="notepad-input-row">
        <textarea class="notepad-textarea" placeholder="Quick note… (Ctrl+Enter to save)" rows="2" maxlength="${MAX_NOTE_LENGTH}"></textarea>
        <button class="notepad-add-btn" title="Add note" aria-label="Add note">+</button>
      </div>
      <div class="notepad-list">
        ${sortedNotes.length === 0 ? '<div class="notepad-empty">No notes yet</div>' : ''}
        ${sortedNotes.map(n => {
          const colorStyle = isAllowedColor(n.color) ? `border-left: 3px solid ${n.color}` : '';
          return `
          <div class="notepad-note ${n.pinned ? 'pinned' : ''}" data-id="${escapeHtml(n.id)}"
               ${colorStyle ? `style="${colorStyle}"` : ''}>
            <div class="notepad-note-text">${escapeHtml(n.text)}</div>
            <div class="notepad-note-meta">
              <span class="notepad-time">${this.formatTime(n.ts)}</span>
              <div class="notepad-actions">
                <button class="notepad-action pin-btn" title="${n.pinned ? 'Unpin' : 'Pin'}" data-action="pin" aria-label="${n.pinned ? 'Unpin note' : 'Pin note'}">${n.pinned ? '📌' : '📍'}</button>
                <button class="notepad-action color-btn" title="Color" data-action="color" aria-label="Change color">🎨</button>
                <button class="notepad-action delete-btn" title="Delete" data-action="delete" aria-label="Delete note">🗑</button>
              </div>
            </div>
          </div>
        `}).join('')}
      </div>
    `;

    // Bind events
    const textarea = this.content.querySelector('.notepad-textarea') as HTMLTextAreaElement;
    const addBtn = this.content.querySelector('.notepad-add-btn') as HTMLButtonElement;

    const addNote = (): void => {
      const text = textarea.value.trim().slice(0, MAX_NOTE_LENGTH);
      if (!text) return;
      this.notes.unshift({ id: generateId(), text, ts: Date.now() });
      this.saveNotes();
      textarea.value = '';
      this.renderNotepad();
    };

    addBtn.addEventListener('click', addNote);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        addNote();
      }
    });

    // Note action buttons
    this.content.querySelectorAll('.notepad-note').forEach(el => {
      const id = el.getAttribute('data-id');
      if (!id) return;
      el.querySelectorAll('.notepad-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = (btn as HTMLElement).dataset.action;
          if (action === 'delete') {
            this.notes = this.notes.filter(n => n.id !== id);
            this.saveNotes();
            this.renderNotepad();
          } else if (action === 'pin') {
            const note = this.notes.find(n => n.id === id);
            if (note) note.pinned = !note.pinned;
            this.saveNotes();
            this.renderNotepad();
          } else if (action === 'color') {
            const note = this.notes.find(n => n.id === id);
            if (note) {
              const colors: (string | undefined)[] = [...ALLOWED_COLORS, undefined];
              const idx = colors.indexOf(note.color);
              note.color = colors[(idx + 1) % colors.length];
              this.saveNotes();
              this.renderNotepad();
            }
          }
        });
      });
    });
  }

  private formatTime(ts: number): string {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 0) return 'just now';
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  public async update(): Promise<void> {
    // No external data fetch needed - notes are local
  }
}
