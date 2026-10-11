import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// =============================================================================
// Types
// =============================================================================

type CalcMode = 'standard' | 'scientific' | 'converter';

const STORAGE_KEY = 'hq-calc-mode';

interface CalcState {
  currentInput: string;
  expression: string;
  hasResult: boolean;
  openParens: number;
}

interface UnitDef {
  label: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

type UnitCategory = 'Length' | 'Weight' | 'Temperature' | 'Volume' | 'Speed' | 'Data' | 'Time';

// =============================================================================
// Calculator Logic - safe recursive descent parser (no eval/Function)
// =============================================================================

/** Tokenize a sanitized math expression into numbers, operators, and parens */
function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (ch === ' ') { i++; continue; }
    if ('()+*/-'.includes(ch) || ch === '%') {
      tokens.push(ch);
      i++;
    } else if (/[\d.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i]!)) { num += expr[i]!; i++; }
      tokens.push(num);
    } else {
      return []; // unexpected character
    }
  }
  return tokens;
}

/**
 * Recursive descent parser for arithmetic expressions.
 * Grammar:
 *   expr   = term (('+' | '-') term)*
 *   term   = unary (('*' | '/') unary)*
 *   unary  = '-' unary | postfix
 *   postfix = atom '%'?
 *   atom   = NUMBER | '(' expr ')'
 */
function parseExpr(tokens: string[], pos: { i: number }): number {
  let left = parseTerm(tokens, pos);
  while (pos.i < tokens.length && (tokens[pos.i] === '+' || tokens[pos.i] === '-')) {
    const op = tokens[pos.i++];
    const right = parseTerm(tokens, pos);
    left = op === '+' ? left + right : left - right;
  }
  return left;
}

function parseTerm(tokens: string[], pos: { i: number }): number {
  let left = parseUnary(tokens, pos);
  while (pos.i < tokens.length && (tokens[pos.i] === '*' || tokens[pos.i] === '/')) {
    const op = tokens[pos.i++];
    const right = parseUnary(tokens, pos);
    left = op === '*' ? left * right : left / right;
  }
  return left;
}

function parseUnary(tokens: string[], pos: { i: number }): number {
  if (pos.i < tokens.length && tokens[pos.i] === '-') {
    pos.i++;
    return -parseUnary(tokens, pos);
  }
  return parsePostfix(tokens, pos);
}

function parsePostfix(tokens: string[], pos: { i: number }): number {
  let value = parseAtom(tokens, pos);
  if (pos.i < tokens.length && tokens[pos.i] === '%') {
    pos.i++;
    value /= 100;
  }
  return value;
}

function parseAtom(tokens: string[], pos: { i: number }): number {
  if (pos.i >= tokens.length) return NaN;
  if (tokens[pos.i] === '(') {
    pos.i++; // consume '('
    const val = parseExpr(tokens, pos);
    if (pos.i < tokens.length && tokens[pos.i] === ')') pos.i++; // consume ')'
    return val;
  }
  const num = Number(tokens[pos.i++]);
  return num;
}

function safeEval(expr: string): number {
  try {
    const sanitized = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/π/g, String(Math.PI))
      .replace(/e(?![+x\-])/g, String(Math.E));
    if (!/^[\d\s%()*+./-]+$/.test(sanitized)) return NaN;
    const tokens = tokenize(sanitized);
    if (tokens.length === 0) return NaN;
    const pos = { i: 0 };
    const result = parseExpr(tokens, pos);
    // If we didn't consume all tokens, the expression is malformed
    if (pos.i !== tokens.length) return NaN;
    return typeof result === 'number' ? result : NaN;
  } catch {
    return NaN;
  }
}

function formatDisplay(n: number): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 'Error';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toString();
  const s = parseFloat(n.toFixed(10)).toString();
  return s.length > 16 ? n.toExponential(6) : s;
}

function applyAction(state: CalcState, action: string, payload?: string): CalcState {
  switch (action) {
    case 'DIGIT': {
      if (state.hasResult) {
        return { ...state, currentInput: payload!, expression: '', hasResult: false };
      }
      const input = state.currentInput === '0' ? payload! : state.currentInput + payload!;
      return { ...state, currentInput: input };
    }
    case 'DECIMAL': {
      if (state.hasResult) return { ...state, currentInput: '0.', expression: '', hasResult: false };
      const lastNum = state.currentInput.split(/[()+×÷-]/).pop() || '';
      if (lastNum.includes('.')) return state;
      return { ...state, currentInput: state.currentInput + '.' };
    }
    case 'OPERATOR': {
      const lastChar = state.currentInput.slice(-1);
      if (['+', '-', '×', '÷'].includes(lastChar)) {
        return { ...state, currentInput: state.currentInput.slice(0, -1) + payload! };
      }
      return { ...state, currentInput: state.currentInput + payload!, hasResult: false };
    }
    case 'EQUALS': {
      const result = safeEval(state.currentInput);
      return { currentInput: formatDisplay(result), expression: state.currentInput + ' =', hasResult: true, openParens: 0 };
    }
    case 'CLEAR':
      return { currentInput: '0', expression: '', hasResult: false, openParens: 0 };
    case 'BACKSPACE': {
      if (state.hasResult) return { currentInput: '0', expression: '', hasResult: false, openParens: 0 };
      if (state.currentInput.length <= 1) return { ...state, currentInput: '0' };
      const removed = state.currentInput.slice(-1);
      let parens = state.openParens;
      if (removed === '(') parens--;
      if (removed === ')') parens++;
      return { ...state, currentInput: state.currentInput.slice(0, -1), openParens: parens };
    }
    case 'NEGATE': {
      if (state.currentInput === '0') return state;
      if (state.hasResult) {
        const val = parseFloat(state.currentInput);
        return { ...state, currentInput: formatDisplay(-val), expression: '', hasResult: false };
      }
      if (state.currentInput.startsWith('-')) return { ...state, currentInput: state.currentInput.slice(1) };
      return { ...state, currentInput: '-' + state.currentInput };
    }
    case 'PERCENT': {
      const v = safeEval(state.currentInput);
      return { ...state, currentInput: formatDisplay(v / 100), hasResult: true };
    }
    case 'FUNCTION': {
      const val = safeEval(state.currentInput);
      let result: number;
      switch (payload) {
        case 'sin': result = Math.sin(val); break;
        case 'cos': result = Math.cos(val); break;
        case 'tan': result = Math.tan(val); break;
        case 'log': result = Math.log10(val); break;
        case 'ln': result = Math.log(val); break;
        case '√': result = Math.sqrt(val); break;
        case 'x²': result = val * val; break;
        case '!': {
          if (val < 0 || !Number.isInteger(val) || val > 170) { result = NaN; }
          else { let f = 1; for (let i = 2; i <= val; i++) f *= i; result = f; }
          break;
        }
        default: result = val;
      }
      return { currentInput: formatDisplay(result), expression: `${payload}(${state.currentInput})`, hasResult: true, openParens: 0 };
    }
    case 'OPEN_PAREN': {
      const ci = state.hasResult ? '(' : (state.currentInput === '0' ? '(' : state.currentInput + '(');
      return { ...state, currentInput: ci, hasResult: false, openParens: state.openParens + 1 };
    }
    case 'CLOSE_PAREN': {
      if (state.openParens <= 0) return state;
      return { ...state, currentInput: state.currentInput + ')', openParens: state.openParens - 1 };
    }
    case 'CONSTANT': {
      const c = payload === 'π' ? Math.PI.toString() : Math.E.toString();
      if (state.hasResult) return { ...state, currentInput: c, expression: '', hasResult: false };
      const lastC = state.currentInput.slice(-1);
      if (/\d/.test(lastC) || lastC === '.') return { ...state, currentInput: state.currentInput + '×' + c };
      return { ...state, currentInput: state.currentInput === '0' ? c : state.currentInput + c };
    }
    default:
      return state;
  }
}

// =============================================================================
// Unit Converter Data
// =============================================================================

const UNIT_DATA: Record<UnitCategory, UnitDef[]> = {
  Length: [
    { label: 'meters', toBase: v => v, fromBase: v => v },
    { label: 'km', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { label: 'cm', toBase: v => v / 100, fromBase: v => v * 100 },
    { label: 'miles', toBase: v => v * 1609.344, fromBase: v => v / 1609.344 },
    { label: 'feet', toBase: v => v / 3.28084, fromBase: v => v * 3.28084 },
    { label: 'inches', toBase: v => v / 39.3701, fromBase: v => v * 39.3701 },
    { label: 'yards', toBase: v => v / 1.09361, fromBase: v => v * 1.09361 },
  ],
  Weight: [
    { label: 'kg', toBase: v => v, fromBase: v => v },
    { label: 'g', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { label: 'lbs', toBase: v => v / 2.20462, fromBase: v => v * 2.20462 },
    { label: 'oz', toBase: v => v / 35.274, fromBase: v => v * 35.274 },
    { label: 'tonnes', toBase: v => v * 1000, fromBase: v => v / 1000 },
  ],
  Temperature: [
    { label: '°C', toBase: v => v, fromBase: v => v },
    { label: '°F', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
    { label: 'K', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
  ],
  Volume: [
    { label: 'liters', toBase: v => v, fromBase: v => v },
    { label: 'mL', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { label: 'gallons', toBase: v => v * 3.785, fromBase: v => v / 3.785 },
    { label: 'fl oz', toBase: v => v / 33.814, fromBase: v => v * 33.814 },
    { label: 'cups', toBase: v => v / 4.227, fromBase: v => v * 4.227 },
  ],
  Speed: [
    { label: 'm/s', toBase: v => v, fromBase: v => v },
    { label: 'km/h', toBase: v => v / 3.6, fromBase: v => v * 3.6 },
    { label: 'mph', toBase: v => v / 2.237, fromBase: v => v * 2.237 },
    { label: 'knots', toBase: v => v / 1.944, fromBase: v => v * 1.944 },
  ],
  Data: [
    { label: 'bytes', toBase: v => v, fromBase: v => v },
    { label: 'KB', toBase: v => v * 1024, fromBase: v => v / 1024 },
    { label: 'MB', toBase: v => v * 1_048_576, fromBase: v => v / 1_048_576 },
    { label: 'GB', toBase: v => v * 1_073_741_824, fromBase: v => v / 1_073_741_824 },
    { label: 'TB', toBase: v => v * 1_099_511_627_776, fromBase: v => v / 1_099_511_627_776 },
  ],
  Time: [
    { label: 'seconds', toBase: v => v, fromBase: v => v },
    { label: 'minutes', toBase: v => v * 60, fromBase: v => v / 60 },
    { label: 'hours', toBase: v => v * 3600, fromBase: v => v / 3600 },
    { label: 'days', toBase: v => v * 86400, fromBase: v => v / 86400 },
    { label: 'weeks', toBase: v => v * 604800, fromBase: v => v / 604800 },
  ],
};

const UNIT_CATEGORIES = Object.keys(UNIT_DATA) as UnitCategory[];

// =============================================================================
// Panel
// =============================================================================

export class CalculatorPanel extends Panel {
  private mode: CalcMode;
  private calcState: CalcState = { currentInput: '0', expression: '', hasResult: false, openParens: 0 };
  // Converter state
  private convCategory: UnitCategory = 'Length';
  private convFromIdx = 0;
  private convToIdx = 1;
  private convInput = '1';
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super({ id: 'calculator', title: 'Calculator' });
    this.mode = this.loadMode();
    this.renderPanel();
  }

  public destroy(): void {
    this.removeKeyboardHandler();
    super.destroy();
  }

  private loadMode(): CalcMode {
    try {
      return (localStorage.getItem(STORAGE_KEY) as CalcMode) || 'standard';
    } catch {
      return 'standard';
    }
  }

  private saveMode(): void {
    try { localStorage.setItem(STORAGE_KEY, this.mode); } catch { /* noop */ }
  }

  private removeKeyboardHandler(): void {
    if (this.keyboardHandler) {
      window.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }
  }

  private renderPanel(): void {
    const modeButtons = (['standard', 'scientific', 'converter'] as CalcMode[]).map(m =>
      `<button class="calc-mode-btn${this.mode === m ? ' active' : ''}" data-mode="${m}">${m.charAt(0).toUpperCase() + m.slice(1)}</button>`
    ).join('');

    let contentHtml = '';
    switch (this.mode) {
      case 'standard': contentHtml = this.renderStandard(); break;
      case 'scientific': contentHtml = this.renderScientific(); break;
      case 'converter': contentHtml = this.renderConverter(); break;
    }

    const html = `
      <div class="calc-container">
        <div class="calc-mode-selector">${modeButtons}</div>
        ${contentHtml}
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  private renderDisplay(): string {
    return `
      <div class="calc-display">
        <div class="calc-display-expr">${escapeHtml(this.calcState.expression)}</div>
        <div class="calc-display-value">${escapeHtml(this.calcState.currentInput)}</div>
      </div>
    `;
  }

  private renderStandard(): string {
    const buttons = [
      ['C', '±', '%', '÷'],
      ['7', '8', '9', '×'],
      ['4', '5', '6', '-'],
      ['1', '2', '3', '+'],
      ['0', '.', '='],
    ];

    return `
      ${this.renderDisplay()}
      <div class="calc-grid-4">
        ${buttons.map((row, ri) => row.map((label, ci) => {
          const isOp = ['+', '-', '×', '÷'].includes(label);
          const isEq = label === '=';
          const isFunc = ['C', '±', '%'].includes(label);
          const isWideZero = ri === 4 && ci === 0;
          const cls = isEq ? 'calc-btn calc-btn-eq' : isOp ? 'calc-btn calc-btn-op' : isFunc ? 'calc-btn calc-btn-fn' : 'calc-btn';
          const span = isWideZero ? ' style="grid-column:span 2"' : '';
          return `<button class="${cls}" data-btn="${label}"${span}>${escapeHtml(label)}</button>`;
        }).join('')).join('')}
      </div>
    `;
  }

  private renderScientific(): string {
    const sciFns = ['sin', 'cos', 'tan', 'log', 'ln', '√', 'x²', '!', 'π', 'e', '(', ')'];
    const stdButtons = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '±', '0', '.', '='];

    return `
      ${this.renderDisplay()}
      <div class="calc-sci-grid">
        ${sciFns.map(fn => `<button class="calc-btn calc-btn-sci" data-sci="${fn}">${escapeHtml(fn)}</button>`).join('')}
      </div>
      <div class="calc-grid-4">
        ${stdButtons.map(label => {
          const isOp = ['+', '-', '×', '÷'].includes(label);
          const isEq = label === '=';
          const cls = isEq ? 'calc-btn calc-btn-eq' : isOp ? 'calc-btn calc-btn-op' : 'calc-btn';
          return `<button class="${cls}" data-btn="${label}">${escapeHtml(label)}</button>`;
        }).join('')}
      </div>
    `;
  }

  private renderConverter(): string {
    const units = UNIT_DATA[this.convCategory];
    const fromUnit = units[this.convFromIdx] ?? units[0];
    const toUnit = units[this.convToIdx] ?? units[1];

    const num = parseFloat(this.convInput);
    let result = '';
    if (!Number.isNaN(num) && fromUnit && toUnit) {
      const base = fromUnit.toBase(num);
      const converted = toUnit.fromBase(base);
      result = parseFloat(converted.toFixed(10)).toString();
    }

    const categoryOptions = UNIT_CATEGORIES.map(c =>
      `<option value="${c}"${c === this.convCategory ? ' selected' : ''}>${c}</option>`
    ).join('');

    return `
      <div class="calc-converter">
        <select class="calc-conv-category">${categoryOptions}</select>
        <div class="calc-conv-row">
          <select class="calc-conv-from">${units.map((u, i) => `<option value="${i}"${i === this.convFromIdx ? ' selected' : ''}>${escapeHtml(u.label)}</option>`).join('')}</select>
          <input type="text" class="calc-conv-input" value="${escapeHtml(this.convInput)}" />
        </div>
        <div class="calc-conv-row">
          <select class="calc-conv-to">${units.map((u, i) => `<option value="${i}"${i === this.convToIdx ? ' selected' : ''}>${escapeHtml(u.label)}</option>`).join('')}</select>
          <div class="calc-conv-result">${escapeHtml(result)}</div>
        </div>
      </div>
    `;
  }

  private handleButton(label: string): void {
    if (label >= '0' && label <= '9') {
      this.calcState = applyAction(this.calcState, 'DIGIT', label);
    } else if (label === '.') {
      this.calcState = applyAction(this.calcState, 'DECIMAL');
    } else if (['+', '-', '×', '÷'].includes(label)) {
      this.calcState = applyAction(this.calcState, 'OPERATOR', label);
    } else if (label === '=') {
      this.calcState = applyAction(this.calcState, 'EQUALS');
    } else if (label === 'C') {
      this.calcState = applyAction(this.calcState, 'CLEAR');
    } else if (label === '±') {
      this.calcState = applyAction(this.calcState, 'NEGATE');
    } else if (label === '%') {
      this.calcState = applyAction(this.calcState, 'PERCENT');
    } else if (label === '⌫') {
      this.calcState = applyAction(this.calcState, 'BACKSPACE');
    }
    this.renderPanel();
  }

  private handleSci(fn: string): void {
    if (['sin', 'cos', 'tan', 'log', 'ln', '√', 'x²', '!'].includes(fn)) {
      this.calcState = applyAction(this.calcState, 'FUNCTION', fn);
    } else if (fn === 'π' || fn === 'e') {
      this.calcState = applyAction(this.calcState, 'CONSTANT', fn);
    } else if (fn === '(') {
      this.calcState = applyAction(this.calcState, 'OPEN_PAREN');
    } else if (fn === ')') {
      this.calcState = applyAction(this.calcState, 'CLOSE_PAREN');
    }
    this.renderPanel();
  }

  private bindEvents(): void {
    // Mode selector
    this.content.querySelectorAll('.calc-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mode = (btn as HTMLElement).dataset.mode as CalcMode;
        this.saveMode();
        this.renderPanel();
      });
    });

    // Standard / Scientific buttons
    this.content.querySelectorAll('[data-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.handleButton((btn as HTMLElement).dataset.btn!);
      });
    });

    // Scientific function buttons
    this.content.querySelectorAll('[data-sci]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.handleSci((btn as HTMLElement).dataset.sci!);
      });
    });

    // Converter events
    const catSelect = this.content.querySelector('.calc-conv-category') as HTMLSelectElement | null;
    if (catSelect) {
      catSelect.addEventListener('change', () => {
        this.convCategory = catSelect.value as UnitCategory;
        this.convFromIdx = 0;
        this.convToIdx = 1;
        this.convInput = '1';
        this.renderPanel();
      });
    }

    const fromSelect = this.content.querySelector('.calc-conv-from') as HTMLSelectElement | null;
    if (fromSelect) {
      fromSelect.addEventListener('change', () => {
        this.convFromIdx = parseInt(fromSelect.value, 10);
        this.renderPanel();
      });
    }

    const toSelect = this.content.querySelector('.calc-conv-to') as HTMLSelectElement | null;
    if (toSelect) {
      toSelect.addEventListener('change', () => {
        this.convToIdx = parseInt(toSelect.value, 10);
        this.renderPanel();
      });
    }

    const convInput = this.content.querySelector('.calc-conv-input') as HTMLInputElement | null;
    if (convInput) {
      convInput.addEventListener('input', () => {
        this.convInput = convInput.value;
        this.renderPanel();
      });
    }

    // Keyboard support for standard/scientific modes
    this.removeKeyboardHandler();
    if (this.mode !== 'converter') {
      this.keyboardHandler = (e: KeyboardEvent) => {
        // Only handle if no other input is focused
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

        if (e.key >= '0' && e.key <= '9') { this.handleButton(e.key); }
        else if (e.key === '.') { this.handleButton('.'); }
        else if (e.key === '+') { this.handleButton('+'); }
        else if (e.key === '-') { this.handleButton('-'); }
        else if (e.key === '*') { this.handleButton('×'); }
        else if (e.key === '/') { e.preventDefault(); this.handleButton('÷'); }
        else if (e.key === 'Enter' || e.key === '=') { this.handleButton('='); }
        else if (e.key === 'Escape') { this.handleButton('C'); }
        else if (e.key === 'Backspace') { this.handleButton('⌫'); }
      };
      window.addEventListener('keydown', this.keyboardHandler);
    }
  }
}
