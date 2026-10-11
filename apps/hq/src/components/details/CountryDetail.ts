/**
 * CountryDetail - quick-glance detail renderer for country entities.
 *
 * This is a lightweight summary shown in the DetailPanel slide-over drawer.
 * For the full AI-powered country brief, use CountryBriefPage instead.
 */

interface CountryDetailData {
  name?: string;
  code?: string; // ISO 3166-1 alpha-2
  title?: string; // Fallback
  riskScore?: number;
  riskLevel?: string;
  population?: number;
  region?: string;
  lat?: number;
  lon?: number;
}

/* ── Helpers ── */

/** Derive flag emoji from ISO 3166-1 alpha-2 code. */
function countryFlag(code: string): string {
  try {
    return String.fromCodePoint(
      ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
    );
  } catch {
    return '🏳️';
  }
}

/** Color for risk score (0-100). */
function riskColor(score: number): string {
  if (score >= 75) return '#ef4444';
  if (score >= 50) return '#f59e0b';
  if (score >= 25) return '#3b82f6';
  return '#22c55e';
}

/** Format large numbers with K/M/B suffixes. */
function formatPopulation(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

/* ── Renderer ── */

export function getTitle(data: unknown): string {
  const d = data as CountryDetailData;
  return d.name || d.title || d.code || 'Country';
}

export function render(container: HTMLElement, data: unknown): void {
  const d = data as CountryDetailData;
  const name = d.name || d.title || d.code || 'Unknown';
  const code = d.code?.toUpperCase() || '';

  /* ── Header ── */
  const header = document.createElement('div');
  header.className = 'detail-section';
  header.style.cssText =
    'display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08)';
  const flag = document.createElement('span');
  flag.style.fontSize = '36px';
  flag.textContent = code ? countryFlag(code) : '🏳️';
  const nameEl = document.createElement('div');
  nameEl.innerHTML = `<div style="font-size:18px;font-weight:700;color:#e0e0e0">${name}</div>${code ? `<div style="font-size:12px;color:#888;margin-top:2px">${code}</div>` : ''}`;
  header.appendChild(flag);
  header.appendChild(nameEl);
  container.appendChild(header);

  /* ── Risk Overview ── */
  if (d.riskScore != null) {
    const section = document.createElement('div');
    section.className = 'detail-section';
    const title = document.createElement('div');
    title.className = 'detail-section-title';
    title.textContent = 'Risk Overview';
    section.appendChild(title);

    const barOuter = document.createElement('div');
    barOuter.style.cssText =
      'width:100%;height:8px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden;margin-bottom:6px';
    const barInner = document.createElement('div');
    barInner.style.cssText = `width:${Math.min(d.riskScore, 100)}%;height:100%;border-radius:4px;background:${riskColor(d.riskScore)};transition:width 0.4s ease`;
    barOuter.appendChild(barInner);
    section.appendChild(barOuter);

    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;justify-content:space-between;font-size:12px';
    meta.innerHTML = `<span style="color:${riskColor(d.riskScore)};font-weight:600">${d.riskScore.toFixed(1)}/100</span>${d.riskLevel ? `<span style="color:#888">${d.riskLevel}</span>` : ''}`;
    section.appendChild(meta);
    container.appendChild(section);
  }

  /* ── Quick Stats ── */
  const hasStats = d.population || d.region || code;
  if (hasStats) {
    const section = document.createElement('div');
    section.className = 'detail-section';
    const title = document.createElement('div');
    title.className = 'detail-section-title';
    title.textContent = 'Quick Stats';
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'detail-metric-grid';

    if (d.population) {
      grid.innerHTML += `<div class="detail-metric"><div class="detail-metric-label">Population</div><div class="detail-metric-value">${formatPopulation(d.population)}</div></div>`;
    }
    if (d.region) {
      grid.innerHTML += `<div class="detail-metric"><div class="detail-metric-label">Region</div><div class="detail-metric-value" style="font-size:14px">${d.region}</div></div>`;
    }
    if (code) {
      grid.innerHTML += `<div class="detail-metric"><div class="detail-metric-label">ISO Code</div><div class="detail-metric-value">${code}</div></div>`;
    }

    section.appendChild(grid);
    container.appendChild(section);
  }

  /* ── Actions ── */
  const actions = document.createElement('div');
  actions.className = 'detail-section';
  const actTitle = document.createElement('div');
  actTitle.className = 'detail-section-title';
  actTitle.textContent = 'Actions';
  actions.appendChild(actTitle);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';

  if (code) {
    const briefBtn = document.createElement('button');
    briefBtn.textContent = 'View Full Brief';
    briefBtn.style.cssText =
      'padding:8px 14px;border-radius:6px;border:none;background:rgba(96,165,250,0.15);color:#60a5fa;font-size:12px;font-weight:600;cursor:pointer;transition:background 0.2s';
    briefBtn.addEventListener('mouseenter', () => {
      briefBtn.style.background = 'rgba(96,165,250,0.25)';
    });
    briefBtn.addEventListener('mouseleave', () => {
      briefBtn.style.background = 'rgba(96,165,250,0.15)';
    });
    briefBtn.addEventListener('click', () => {
      window.dispatchEvent(
        new CustomEvent('country:open-brief', { detail: { code, name } }),
      );
    });
    btnRow.appendChild(briefBtn);
  }

  if (d.lat != null && d.lon != null) {
    const mapBtn = document.createElement('button');
    mapBtn.textContent = 'View on Map';
    mapBtn.style.cssText =
      'padding:8px 14px;border-radius:6px;border:none;background:rgba(255,255,255,0.06);color:#ccc;font-size:12px;font-weight:600;cursor:pointer;transition:background 0.2s';
    mapBtn.addEventListener('mouseenter', () => {
      mapBtn.style.background = 'rgba(255,255,255,0.12)';
    });
    mapBtn.addEventListener('mouseleave', () => {
      mapBtn.style.background = 'rgba(255,255,255,0.06)';
    });
    mapBtn.addEventListener('click', () => {
      window.dispatchEvent(
        new CustomEvent('detail:fly-to', {
          detail: { lat: d.lat, lon: d.lon },
        }),
      );
    });
    btnRow.appendChild(mapBtn);
  }

  actions.appendChild(btnRow);
  container.appendChild(actions);

  /* ── External Links ── */
  if (code) {
    const links = document.createElement('div');
    links.className = 'detail-section';
    const lTitle = document.createElement('div');
    lTitle.className = 'detail-section-title';
    lTitle.textContent = 'External Links';
    links.appendChild(lTitle);

    const linkList = document.createElement('div');
    linkList.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    const wikiLink = document.createElement('a');
    wikiLink.className = 'detail-link';
    wikiLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`;
    wikiLink.target = '_blank';
    wikiLink.rel = 'noopener noreferrer';
    wikiLink.textContent = `📖 Wikipedia - ${name}`;
    linkList.appendChild(wikiLink);

    const ciaLink = document.createElement('a');
    ciaLink.className = 'detail-link';
    ciaLink.href = `https://www.cia.gov/the-world-factbook/countries/${name.toLowerCase().replace(/\s+/g, '-')}/`;
    ciaLink.target = '_blank';
    ciaLink.rel = 'noopener noreferrer';
    ciaLink.textContent = `🌐 CIA World Factbook`;
    linkList.appendChild(ciaLink);

    links.appendChild(linkList);
    container.appendChild(links);
  }
}
