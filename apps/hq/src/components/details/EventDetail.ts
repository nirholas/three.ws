/**
 * EventDetail - renderer for geopolitical / natural event detail views.
 * Handles earthquakes, fires, conflicts, climate anomalies, population
 * exposure, military events, etc.
 */

import { escapeHtml } from '@/utils/sanitize';

/* ── Interfaces ── */

interface EventDetailData {
  title: string;
  category?: string;  // earthquake | fire | conflict | climate | economic | social | population | military
  description?: string;
  lat?: number;
  lon?: number;
  magnitude?: number;
  depth?: number;
  date?: string;
  source?: string;
  url?: string;
  severity?: string;  // critical | high | medium | low
  affected?: string;
  deaths?: number;
  country?: string;
  value?: string | number;
  unit?: string;
}

/* ── Helpers ── */

const CATEGORY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  earthquake: '#f97316',
  fire: '#ef4444',
  conflict: '#991b1b',
  climate: '#3b82f6',
  economic: '#14b8a6',
  social: '#8b5cf6',
  population: '#ec4899',
  military: '#6b7280',
  high: '#f97316',
  medium: '#eab308',
  low: '#84cc16',
  tech: '#14b8a6',
};

function badgeColor(data: EventDetailData): string {
  if (data.severity && data.severity in CATEGORY_COLORS) return CATEGORY_COLORS[data.severity] ?? '#6b7280';
  if (data.category && data.category in CATEGORY_COLORS) return CATEGORY_COLORS[data.category] ?? '#6b7280';
  return '#6b7280';
}

function formatDate(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return escapeHtml(raw);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return escapeHtml(raw);
  }
}

function coordStr(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lon).toFixed(4)}°${lonDir}`;
}

/* ── Public API ── */

export function getTitle(data: unknown): string {
  const d = data as EventDetailData | null;
  if (!d) return 'Event';

  // Earthquake-specific title
  if (d.category === 'earthquake' && d.magnitude != null) {
    const loc = d.country || '';
    return `M${d.magnitude} Earthquake${loc ? ` - ${loc}` : ''}`;
  }

  // Climate-specific
  if (d.category === 'climate') {
    const loc = d.country || '';
    return `Climate Anomaly${loc ? ` - ${loc}` : ''}`;
  }

  if (d.title) return d.title;
  const raw = d as unknown as Record<string, unknown>;
  if (typeof raw.name === 'string') return raw.name;
  return 'Event';
}

export function render(container: HTMLElement, data: unknown): void {
  const d = ((data ?? {}) as EventDetailData);
  const color = badgeColor(d);
  const parts: string[] = [];

  /* ── 1. Header with severity / category badge ── */
  const badge = d.severity || d.category || '';
  parts.push(`
    <div class="detail-section">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:16px;font-weight:600;color:#eee">${escapeHtml(d.title || 'Unknown Event')}</span>
        ${badge ? `<span class="detail-chip" style="background:${color};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;text-transform:uppercase">${escapeHtml(badge)}</span>` : ''}
      </div>
    </div>
  `);

  /* ── 2. Location ── */
  if (d.lat != null && d.lon != null) {
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Location</div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="color:#aaa;font-family:monospace;font-size:13px">${coordStr(d.lat, d.lon)}</span>
          ${d.country ? `<span style="cursor:pointer;color:#60a5fa;text-decoration:underline;font-size:13px" data-country-detail="${escapeHtml(d.country)}">${escapeHtml(d.country)}</span>` : ''}
          <button class="detail-link event-detail-flyto" data-lat="${d.lat}" data-lon="${d.lon}" style="cursor:pointer;background:none;border:1px solid #444;border-radius:4px;color:#60a5fa;padding:3px 10px;font-size:12px">View on Map ↗</button>
        </div>
      </div>
    `);
  } else if (d.country) {
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Location</div>
        <span style="cursor:pointer;color:#60a5fa;text-decoration:underline;font-size:13px" data-country-detail="${escapeHtml(d.country)}">${escapeHtml(d.country)}</span>
      </div>
    `);
  }

  /* ── 3. Details Grid ── */
  const metrics: Array<{ label: string; value: string }> = [];

  switch (d.category) {
    case 'earthquake':
      if (d.magnitude != null) metrics.push({ label: 'Magnitude', value: `M${d.magnitude}` });
      if (d.depth != null) metrics.push({ label: 'Depth', value: `${d.depth} km` });
      if (d.date) metrics.push({ label: 'Date', value: formatDate(d.date) });
      break;

    case 'conflict':
      if (d.deaths != null) metrics.push({ label: 'Fatalities', value: d.deaths.toLocaleString() });
      if (d.country) metrics.push({ label: 'Country', value: `<span style="cursor:pointer;color:#60a5fa;text-decoration:underline" data-country-detail="${escapeHtml(d.country)}">${escapeHtml(d.country)}</span>` });
      if (d.date) metrics.push({ label: 'Date', value: formatDate(d.date) });
      if (d.affected) metrics.push({ label: 'Actors', value: escapeHtml(d.affected) });
      break;

    case 'climate':
      if (d.value != null) metrics.push({ label: 'Anomaly', value: `${d.value}${d.unit ? ' ' + d.unit : ''}` });
      if (d.date) metrics.push({ label: 'Date', value: formatDate(d.date) });
      break;

    case 'fire':
      if (d.value != null) metrics.push({ label: 'Brightness', value: `${d.value}${d.unit ? ' ' + d.unit : ''}` });
      if (d.date) metrics.push({ label: 'Date', value: formatDate(d.date) });
      break;

    case 'population':
      if (d.affected) metrics.push({ label: 'Affected', value: escapeHtml(d.affected) });
      if (d.date) metrics.push({ label: 'Date', value: formatDate(d.date) });
      break;

    default:
      if (d.value != null) metrics.push({ label: 'Value', value: `${d.value}${d.unit ? ' ' + d.unit : ''}` });
      if (d.date) metrics.push({ label: 'Date', value: formatDate(d.date) });
      if (d.affected) metrics.push({ label: 'Affected', value: escapeHtml(d.affected) });
      if (d.deaths != null) metrics.push({ label: 'Fatalities', value: d.deaths.toLocaleString() });
      break;
  }

  if (metrics.length > 0) {
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Details</div>
        <div class="detail-metric-grid">
          ${metrics.map(m => `
            <div class="detail-metric">
              <span class="detail-metric-label">${m.label}</span>
              <span class="detail-metric-value">${m.value}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `);
  }

  /* ── 4. Description ── */
  if (d.description) {
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Description</div>
        <p style="color:#bbb;font-size:13px;line-height:1.6;margin:0">${escapeHtml(d.description)}</p>
      </div>
    `);
  }

  /* ── 5. Source + link ── */
  if (d.source || d.url) {
    parts.push(`
      <div class="detail-section">
        <div class="detail-section-title">Source</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${d.source ? `<span style="color:#888;font-size:12px">${escapeHtml(d.source)}</span>` : ''}
          ${d.url ? `<a class="detail-link" href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer">View Source ↗</a>` : ''}
          ${d.url ? `<button class="detail-link" style="cursor:pointer;background:none;border:1px solid #444;border-radius:4px;color:#60a5fa;padding:3px 10px;font-size:12px" data-news-detail>Full Coverage</button>` : ''}
        </div>
      </div>
    `);
  }

  container.innerHTML = parts.join('');

  /* ── Wire "View on Map" button ── */
  const flyBtn = container.querySelector('.event-detail-flyto') as HTMLButtonElement | null;
  if (flyBtn) {
    flyBtn.addEventListener('click', () => {
      const lat = parseFloat(flyBtn.dataset.lat || '0');
      const lon = parseFloat(flyBtn.dataset.lon || '0');
      window.dispatchEvent(new CustomEvent('detail:fly-to', { detail: { lat, lon } }));
    });
  }

  /* ── Wire country name clicks ── */
  container.querySelectorAll('[data-country-detail]').forEach(el => {
    (el as HTMLElement).addEventListener('click', () => {
      const country = el.getAttribute('data-country-detail') || '';
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'event', data: { title: country, category: 'country' } }
      }));
    });
  });

  /* ── Wire "Full Coverage" button ── */
  const newsBtn = container.querySelector('[data-news-detail]') as HTMLButtonElement | null;
  if (newsBtn) {
    newsBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('detail:open', {
        detail: { type: 'news', data: { title: d.title, url: d.url, source: d.source } }
      }));
    });
  }
}
