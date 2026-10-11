import { h, Component } from 'preact';

export interface VerificationCheck {
  id: string;
  label: string;
  checked: boolean;
  icon: string;
}

export interface VerificationResult {
  score: number;  // 0-100
  checks: VerificationCheck[];
  verdict: 'verified' | 'likely' | 'uncertain' | 'unreliable';
  notes: string[];
}

const VERIFICATION_TEMPLATE: VerificationCheck[] = [
  { id: 'recency', label: 'Recent timestamp confirmed', checked: false, icon: '🕐' },
  { id: 'geolocation', label: 'Location verified', checked: false, icon: '📍' },
  { id: 'source', label: 'Primary source identified', checked: false, icon: '📰' },
  { id: 'crossref', label: 'Cross-referenced with other sources', checked: false, icon: '🔗' },
  { id: 'no_ai', label: 'No AI generation artifacts', checked: false, icon: '🤖' },
  { id: 'no_recrop', label: 'Not recycled/old footage', checked: false, icon: '🔄' },
  { id: 'metadata', label: 'Metadata verified', checked: false, icon: '📋' },
  { id: 'context', label: 'Context established', checked: false, icon: '📖' },
];

export class VerificationChecklist extends Component {
  private checks: VerificationCheck[] = VERIFICATION_TEMPLATE.map(c => ({ ...c }));
  private notes: string[] = [];
  private manualNote: string = '';

  private toggleCheck(id: string): void {
    this.checks = this.checks.map(c =>
      c.id === id ? { ...c, checked: !c.checked } : c
    );
    this.setState({});
  }

  private addNote(): void {
    if (this.manualNote.trim()) {
      this.notes = [...this.notes, this.manualNote.trim()];
      this.manualNote = '';
      this.setState({});
    }
  }

  private calculateResult(): VerificationResult {
    const checkedCount = this.checks.filter(c => c.checked).length;
    const score = Math.round((checkedCount / this.checks.length) * 100);

    let verdict: VerificationResult['verdict'];
    if (score >= 90) verdict = 'verified';
    else if (score >= 70) verdict = 'likely';
    else if (score >= 40) verdict = 'uncertain';
    else verdict = 'unreliable';

    return { score, checks: this.checks, verdict, notes: this.notes };
  }

  private reset(): void {
    this.checks = VERIFICATION_TEMPLATE.map(c => ({ ...c }));
    this.notes = [];
    this.manualNote = '';
    this.setState({});
  }

  render() {
    const result = this.calculateResult();

    const verdictColors: Record<string, string> = {
      verified: '#22c55e',
      likely: '#84cc16',
      uncertain: '#eab308',
      unreliable: '#ef4444',
    };

    const verdictLabels: Record<string, string> = {
      verified: 'VERIFIED',
      likely: 'LIKELY AUTHENTIC',
      uncertain: 'UNCERTAIN',
      unreliable: 'UNRELIABLE',
    };

    return h('div', { class: 'verification-checklist' },
      h('div', { class: 'checklist-header' },
        h('h3', null, 'Information Verification Checklist'),
        h('p', { class: 'hint' }, 'Based on Bellingcat\'s OSH Framework'),
      ),
      h('div', {
        class: 'score-display',
        style: `background-color: ${verdictColors[result.verdict]}20; border-color: ${verdictColors[result.verdict]}`,
      },
        h('div', { class: 'score-value' }, `${result.score}%`),
        h('div', { class: 'score-label', style: `color: ${verdictColors[result.verdict]}` },
          verdictLabels[result.verdict],
        ),
      ),
      h('div', { class: 'checks-grid' },
        ...this.checks.map(check =>
          h('label', { key: check.id, class: `check-item ${check.checked ? 'checked' : ''}` },
            h('input', {
              type: 'checkbox',
              checked: check.checked,
              onChange: () => this.toggleCheck(check.id),
            }),
            h('span', { class: 'icon' }, check.icon),
            h('span', { class: 'label' }, check.label),
          )
        ),
      ),
      h('div', { class: 'notes-section' },
        h('h4', null, 'Verification Notes'),
        h('div', { class: 'notes-list' },
          this.notes.length === 0
            ? h('p', { class: 'empty' }, 'No notes added')
            : this.notes.map((note, i) =>
                h('div', { key: i, class: 'note-item' }, `• ${note}`)
              ),
        ),
        h('div', { class: 'add-note' },
          h('input', {
            type: 'text',
            value: this.manualNote,
            onInput: (e: Event) => { this.manualNote = (e.target as HTMLInputElement).value; },
            placeholder: 'Add verification note...',
            onKeyPress: (e: KeyboardEvent) => { if (e.key === 'Enter') this.addNote(); },
          }),
          h('button', { onClick: () => this.addNote() }, 'Add'),
        ),
      ),
      h('div', { class: 'checklist-actions' },
        h('button', { class: 'reset-btn', onClick: () => this.reset() }, 'Reset Checklist'),
      ),
      h('style', null, `
        .verification-checklist { background: #0d0d0d; border-radius: 8px; padding: 16px; max-width: 400px; }
        .checklist-header h3 { margin: 0 0 4px; font-size: 14px; color: #fff; }
        .hint { margin: 0; font-size: 11px; color: #666; }
        .score-display { margin: 16px 0; padding: 16px; border-radius: 8px; border: 2px solid; text-align: center; }
        .score-value { font-size: 32px; font-weight: 700; color: #fff; }
        .score-label { font-size: 12px; font-weight: 600; text-transform: uppercase; }
        .checks-grid { display: flex; flex-direction: column; gap: 8px; margin: 16px 0; }
        .check-item { display: flex; align-items: center; gap: 8px; padding: 8px; background: #1a1a1a; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
        .check-item:hover { background: #222; }
        .check-item.checked { background: #1a3a1a; }
        .check-item input { width: 16px; height: 16px; }
        .icon { font-size: 14px; }
        .label { font-size: 12px; color: #ddd; }
        .notes-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid #222; }
        .notes-section h4 { margin: 0 0 8px; font-size: 12px; color: #888; }
        .notes-list { max-height: 100px; overflow-y: auto; }
        .note-item { font-size: 11px; color: #aaa; padding: 4px 0; }
        .empty { font-size: 11px; color: #444; font-style: italic; }
        .add-note { display: flex; gap: 8px; margin-top: 8px; }
        .add-note input { flex: 1; padding: 6px 8px; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; color: #ddd; font-size: 12px; }
        .add-note button { padding: 6px 12px; background: #333; border: none; border-radius: 4px; color: #fff; font-size: 12px; cursor: pointer; }
        .checklist-actions { margin-top: 16px; padding-top: 16px; border-top: 1px solid #222; }
        .reset-btn { width: 100%; padding: 8px; background: #2a2a2a; border: none; border-radius: 4px; color: #888; font-size: 12px; cursor: pointer; }
        .reset-btn:hover { background: #333; color: #aaa; }
      `),
    );
  }
}
