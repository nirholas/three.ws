import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// =============================================================================
// Types
// =============================================================================

interface DNAToken {
  symbol: string;
  percentage: number;
}

interface DNASegment {
  label: string;
  ratio: number;
  angle: number;
  color: string;
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'hq-portfolio-dna';

const ASSET_COLORS: string[] = [
  '#627EEA', '#F7931A', '#9945FF', '#2775CA', '#E84142',
  '#28A0F0', '#0052FF', '#F3BA2F', '#8247E5', '#52c41a',
  '#FF6B35', '#00A3FF', '#E6007A', '#6B8AFF', '#FF007A',
];

const CHAIN_COLORS: Record<string, string> = {
  BTC: '#F7931A', ETH: '#627EEA', SOL: '#9945FF', BNB: '#F3BA2F',
  AVAX: '#E84142', ARB: '#28A0F0', BASE: '#0052FF', OP: '#FF0420',
  MATIC: '#8247E5', DOT: '#E6007A', ATOM: '#6F7390', LINK: '#2A5ADA',
  UNI: '#FF007A', AAVE: '#B6509E', CRV: '#FFD700',
};

// =============================================================================
// Helpers
// =============================================================================

function loadTokens(): DNAToken[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DNAToken[]) : [];
  } catch {
    return [];
  }
}

function saveTokens(tokens: DNAToken[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash = Math.trunc(hash);
  }
  return () => {
    hash = ((hash * 1_103_515_245) + 12_345) & 0x7FFF_FFFF;
    return hash / 0x7FFF_FFFF;
  };
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function generateDNA(tokens: DNAToken[]): { segments: DNASegment[]; diversityScore: number; totalPct: number } {
  if (!tokens.length) return { segments: [], diversityScore: 0, totalPct: 0 };

  const totalPct = tokens.reduce((s, t) => s + t.percentage, 0);
  if (totalPct <= 0) return { segments: [], diversityScore: 0, totalPct: 0 };

  const sorted = [...tokens].sort((a, b) => b.percentage - a.percentage).slice(0, 12);

  let cumulativeAngle = 0;
  const segments: DNASegment[] = sorted.map((token, idx) => {
    const ratio = token.percentage / totalPct;
    const angleSpan = ratio * 360;
    const segment: DNASegment = {
      label: token.symbol.toUpperCase(),
      ratio,
      angle: cumulativeAngle,
      color: CHAIN_COLORS[token.symbol.toUpperCase()] ?? ASSET_COLORS[idx % ASSET_COLORS.length] ?? '#627EEA',
    };
    cumulativeAngle += angleSpan;
    return segment;
  });

  // Diversity score: 1 - HHI (Herfindahl-Hirschman Index)
  const hhi = segments.reduce((sum, s) => sum + s.ratio * s.ratio, 0);
  const diversityScore = Math.round((1 - hhi) * 100);

  return { segments, diversityScore, totalPct };
}

// =============================================================================
// PortfolioDNAPanel
// =============================================================================

export class PortfolioDNAPanel extends Panel {
  private tokens: DNAToken[] = [];
  private showForm = false;

  constructor() {
    super({ id: 'portfolio-dna', title: 'Portfolio DNA' });
    this.tokens = loadTokens();
    this.render();
  }

  private render(): void {
    const { segments, diversityScore, totalPct } = generateDNA(this.tokens);

    const svg = this.generateSVG(segments, diversityScore);

    const legend = segments.slice(0, 8).map(seg =>
      `<span class="dna-legend-item">
        <span class="dna-legend-dot" style="background:${seg.color}"></span>
        <span class="dna-legend-label">${escapeHtml(seg.label)} ${(seg.ratio * 100).toFixed(0)}%</span>
      </span>`
    ).join('');

    const tokenRows = this.tokens.map((t, i) =>
      `<div class="dna-token-row">
        <span class="dna-token-symbol">${escapeHtml(t.symbol.toUpperCase())}</span>
        <span class="dna-token-pct">${t.percentage.toFixed(1)}%</span>
        <button class="dna-token-remove" data-idx="${i}" title="Remove">✕</button>
      </div>`
    ).join('');

    const formHtml = this.showForm ? `
      <div class="dna-add-form">
        <input class="dna-input" type="text" placeholder="Symbol (e.g. ETH)" id="dna-symbol" maxlength="10" />
        <input class="dna-input dna-input-pct" type="number" placeholder="%" id="dna-pct" min="0.1" max="100" step="0.1" />
        <button class="dna-add-submit" id="dna-submit">Add</button>
      </div>
    ` : '';

    const totalValid = totalPct > 0;
    const totalWarn = totalPct > 0 && Math.abs(totalPct - 100) > 0.5;

    const html = `
      <div class="dna-container">
        <div class="dna-actions">
          <button class="dna-add-btn" id="dna-toggle-form">${this.showForm ? 'Cancel' : '+ Add Token'}</button>
          ${this.tokens.length > 0 ? `<button class="dna-clear-btn" id="dna-clear">Clear All</button>` : ''}
        </div>
        ${formHtml}
        ${this.tokens.length > 0 ? `
          <div class="dna-token-list">${tokenRows}</div>
          ${totalWarn ? `<div class="dna-total-warn">Total: ${totalPct.toFixed(1)}% (should be ~100%)</div>` : ''}
        ` : ''}
        ${totalValid ? `
          <div class="dna-svg-wrap">${svg}</div>
          <div class="dna-score">
            <span class="dna-score-label">Diversity Score</span>
            <span class="dna-score-value">${diversityScore}/100</span>
            <div class="dna-score-bar"><div class="dna-score-fill" style="width:${diversityScore}%"></div></div>
          </div>
          <div class="dna-legend">${legend}</div>
        ` : `
          <div class="dna-empty">
            <div class="dna-empty-icon">◈</div>
            <div>Add tokens to generate your portfolio DNA fingerprint</div>
          </div>
        `}
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  private generateSVG(segments: DNASegment[], diversityScore: number): string {
    if (!segments.length) return '';

    const cx = 130, cy = 130;
    const rand = seededRandom(segments.map(s => s.label + s.ratio.toFixed(4)).join('|'));

    // Outer ring arcs
    const outerArcs = segments.map((seg) => {
      const endAngle = seg.angle + seg.ratio * 360;
      if (seg.ratio < 0.005) return '';
      return `<path d="${describeArc(cx, cy, 110, seg.angle, Math.max(seg.angle + 1, endAngle - 1))}" fill="none" stroke="${seg.color}" stroke-width="14" stroke-linecap="round" opacity="0.9" />`;
    }).join('');

    // Middle ring arcs
    const midArcs = segments.map((seg) => {
      const endAngle = seg.angle + seg.ratio * 360;
      if (seg.ratio < 0.01) return '';
      return `<path d="${describeArc(cx, cy, 88, seg.angle + 2, Math.max(seg.angle + 3, endAngle - 2))}" fill="none" stroke="${seg.color}" stroke-width="8" stroke-linecap="round" opacity="0.5" />`;
    }).join('');

    // Inner dots
    const dots = Array.from({ length: 36 }, (_, i) => {
      const angle = i * 10;
      const r = 68 + rand() * 8;
      const pos = polarToCartesian(cx, cy, r, angle);
      const segIdx = Math.floor((angle / 360) * segments.length);
      const color = segments[segIdx]?.color || '#888';
      return `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${(1.5 + rand() * 2.5).toFixed(1)}" fill="${color}" opacity="${(0.3 + rand() * 0.4).toFixed(2)}" />`;
    }).join('');

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" width="260" height="260" style="max-width:100%">
        <defs>
          <radialGradient id="dnaGlow">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.06"/>
            <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="${cx}" cy="${cy}" r="120" fill="url(#dnaGlow)" />
        ${outerArcs}
        ${midArcs}
        ${dots}
        <circle cx="${cx}" cy="${cy}" r="50" fill="rgba(10,10,10,0.8)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="13" font-weight="700">◈</text>
        <text x="${cx}" y="${cy + 10}" text-anchor="middle" dominant-baseline="central" fill="#e8e8e8" font-size="12" font-weight="600">DNA</text>
        <text x="${cx}" y="${cy + 26}" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,0.5)" font-size="9">Diversity: ${diversityScore}%</text>
      </svg>
    `;
  }

  private bindEvents(): void {
    // Toggle form
    this.content.querySelector('#dna-toggle-form')?.addEventListener('click', () => {
      this.showForm = !this.showForm;
      this.render();
    });

    // Clear all
    this.content.querySelector('#dna-clear')?.addEventListener('click', () => {
      this.tokens = [];
      saveTokens(this.tokens);
      this.render();
    });

    // Submit new token
    const submitBtn = this.content.querySelector('#dna-submit');
    const symbolInput = this.content.querySelector('#dna-symbol') as HTMLInputElement | null;
    const pctInput = this.content.querySelector('#dna-pct') as HTMLInputElement | null;

    const doSubmit = () => {
      const symbol = symbolInput?.value.trim() || '';
      const pct = parseFloat(pctInput?.value || '0');
      if (!symbol || pct <= 0 || pct > 100) return;
      // Check for duplicate
      const existing = this.tokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
      if (existing) {
        existing.percentage = pct;
      } else {
        this.tokens.push({ symbol: symbol.toUpperCase(), percentage: pct });
      }
      saveTokens(this.tokens);
      this.showForm = false;
      this.render();
    };

    submitBtn?.addEventListener('click', doSubmit);
    symbolInput?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') doSubmit(); });
    pctInput?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') doSubmit(); });

    // Remove tokens
    this.content.querySelectorAll('.dna-token-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        this.tokens.splice(idx, 1);
        saveTokens(this.tokens);
        this.render();
      });
    });
  }
}
