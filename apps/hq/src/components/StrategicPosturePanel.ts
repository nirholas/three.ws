import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchCachedTheaterPosture, type CachedTheaterPosture } from '@/services/cached-theater-posture';
import { fetchTrackedVessels, isVesselTrackingConfigured } from '@/services/military-vessels';
import { recalcPostureWithVessels, type TheaterPostureSummary } from '@/services/military-surge';

export class StrategicPosturePanel extends Panel {
  private postures: TheaterPostureSummary[] = [];
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private vesselTimeouts: ReturnType<typeof setTimeout>[] = [];
  private loadingElapsedInterval: ReturnType<typeof setInterval> | null = null;
  private loadingStartTime: number = 0;
  private onLocationClick?: (lat: number, lon: number) => void;
  private lastTimestamp: string = '';
  private isStale: boolean = false;

  constructor() {
    super({
      id: 'sector-overview',
      title: 'Sector Overview',
      showCount: false,
      trackActivity: true,
      infoTooltip: `<strong>Methodology</strong>
        <p>Aggregates DeFi protocol risk and whale activity by sector.</p>
        <ul>
          <li><strong>Normal:</strong> Baseline activity</li>
          <li><strong>Elevated:</strong> Above threshold (50+ large txns)</li>
          <li><strong>Critical:</strong> High concentration (100+ large txns)</li>
        </ul>
        <p><strong>Flash Loan Risk:</strong> Multiple protocols showing correlated large-value transactions.</p>`,
    });
    this.init();
  }

  private init(): void {
    this.showLoading();
    this.fetchAndRender();
    this.startAutoRefresh();
    // Re-augment with vessels after stream has had time to populate
    // AIS data accumulates gradually - check at 30s, 60s, 90s, 120s
    this.vesselTimeouts.push(setTimeout(() => this.reaugmentVessels(), 30 * 1000));
    this.vesselTimeouts.push(setTimeout(() => this.reaugmentVessels(), 60 * 1000));
    this.vesselTimeouts.push(setTimeout(() => this.reaugmentVessels(), 90 * 1000));
    this.vesselTimeouts.push(setTimeout(() => this.reaugmentVessels(), 120 * 1000));
  }

  private startAutoRefresh(): void {
    this.refreshInterval = setInterval(() => this.fetchAndRender(), 5 * 60 * 1000);
  }

  private async reaugmentVessels(): Promise<void> {
    if (this.postures.length === 0) return;
    await this.augmentWithVessels();
    this.render();
  }

  public override showLoading(): void {
    this.loadingStartTime = Date.now();
    this.setContent(`
      <div class="sector-panel">
        <div class="sector-loading">
          <div class="sector-loading-radar">
            <div class="sector-radar-sweep"></div>
            <div class="sector-radar-dot"></div>
          </div>
          <div class="sector-loading-title">Scanning Protocols</div>
          <div class="sector-loading-stages">
            <div class="sector-stage active">
              <span class="sector-stage-dot"></span>
              <span>Aircraft positions</span>
            </div>
            <div class="sector-stage pending">
              <span class="sector-stage-dot"></span>
              <span>Naval vessels</span>
            </div>
            <div class="sector-stage pending">
              <span class="sector-stage-dot"></span>
              <span>Theater analysis</span>
            </div>
          </div>
          <div class="sector-loading-tip">
            Connecting to live ADS-B &amp; AIS streams...
          </div>
          <div class="sector-loading-elapsed">Elapsed: 0s</div>
          <div class="sector-loading-note">
            Initial load takes 30-60 seconds as tracking data accumulates
          </div>
        </div>
      </div>
    `);
    this.startLoadingTimer();
  }

  private startLoadingTimer(): void {
    if (this.loadingElapsedInterval) clearInterval(this.loadingElapsedInterval);
    this.loadingElapsedInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.loadingStartTime) / 1000);
      const elapsedEl = this.content.querySelector('.sector-loading-elapsed');
      if (elapsedEl) {
        elapsedEl.textContent = `Elapsed: ${elapsed}s`;
      }
    }, 1000);
  }

  private stopLoadingTimer(): void {
    if (this.loadingElapsedInterval) {
      clearInterval(this.loadingElapsedInterval);
      this.loadingElapsedInterval = null;
    }
  }

  private showLoadingStage(stage: 'aircraft' | 'vessels' | 'analysis'): void {
    const stages = this.content.querySelectorAll('.sector-stage');
    if (stages.length === 0) return;

    stages.forEach((el, i) => {
      el.classList.remove('active', 'complete');
      if (stage === 'aircraft' && i === 0) el.classList.add('active');
      else if (stage === 'vessels') {
        if (i === 0) el.classList.add('complete');
        else if (i === 1) el.classList.add('active');
      } else if (stage === 'analysis') {
        if (i <= 1) el.classList.add('complete');
        else if (i === 2) el.classList.add('active');
      }
    });
  }

  private async fetchAndRender(): Promise<void> {
    try {
      // Fetch aircraft data from server
      this.showLoadingStage('aircraft');
      const data = await fetchCachedTheaterPosture();
      if (!data || data.postures.length === 0) {
        this.showNoData();
        return;
      }

      // Deep clone to avoid mutating cached data
      this.postures = data.postures.map((p) => ({
        ...p,
        byOperator: { ...p.byOperator },
      }));
      this.lastTimestamp = data.timestamp;
      this.isStale = data.stale || false;

      // Try to augment with vessel data (client-side)
      this.showLoadingStage('vessels');
      await this.augmentWithVessels();

      this.showLoadingStage('analysis');
      this.updateBadges();
      this.render();

      // If we rendered stale localStorage data, re-fetch fresh after a short delay
      if (this.isStale) {
        setTimeout(() => this.fetchAndRender(), 3000);
      }
    } catch (error) {
      console.error('[StrategicPosturePanel] Fetch error:', error);
      this.showFetchError();
    }
  }

  private async augmentWithVessels(): Promise<void> {
    if (!isVesselTrackingConfigured()) {
      return;
    }

    try {
      const { vessels } = await fetchTrackedVessels();
      if (vessels.length === 0) {
        // AIS stream hasn't accumulated data yet - restore from cache
        this.restoreVesselCounts();
        recalcPostureWithVessels(this.postures);
        return;
      }

      // Merge vessel counts into each theater
      for (const posture of this.postures) {
        if (!posture.bounds) continue;

        // Filter vessels within theater bounds
        const theaterVessels = vessels.filter(
          (v) =>
            v.lat >= posture.bounds!.south &&
            v.lat <= posture.bounds!.north &&
            v.lon >= posture.bounds!.west &&
            v.lon <= posture.bounds!.east
        );

        // Count by type
        posture.destroyers = theaterVessels.filter((v) => v.vesselType === 'destroyer').length;
        posture.frigates = theaterVessels.filter((v) => v.vesselType === 'frigate').length;
        posture.carriers = theaterVessels.filter((v) => v.vesselType === 'carrier').length;
        posture.submarines = theaterVessels.filter((v) => v.vesselType === 'submarine').length;
        posture.patrol = theaterVessels.filter((v) => v.vesselType === 'patrol').length;
        posture.auxiliaryVessels = theaterVessels.filter(
          (v) => v.vesselType === 'auxiliary' || v.vesselType === 'special' || v.vesselType === 'amphibious' || v.vesselType === 'icebreaker' || v.vesselType === 'research' || v.vesselType === 'unknown'
        ).length;
        posture.totalVessels = theaterVessels.length;

        // Add vessel operators to byOperator
        for (const v of theaterVessels) {
          const op = v.operator || 'unknown';
          posture.byOperator[op] = (posture.byOperator[op] || 0) + 1;
        }
      }

      // Cache vessel counts per theater in localStorage for instant restore on refresh
      this.cacheVesselCounts();

      // Recalculate posture levels now that vessels are included
      recalcPostureWithVessels(this.postures);
    } catch {
      // Live vessel fetch failed - restore from cache silently
      // Restore cached vessel counts if live fetch failed
      this.restoreVesselCounts();
      recalcPostureWithVessels(this.postures);
    }
  }

  private cacheVesselCounts(): void {
    try {
      const counts: Record<string, { destroyers: number; frigates: number; carriers: number; submarines: number; patrol: number; auxiliaryVessels: number; totalVessels: number }> = {};
      for (const p of this.postures) {
        if (p.totalVessels > 0) {
          counts[p.theaterId] = {
            destroyers: p.destroyers || 0,
            frigates: p.frigates || 0,
            carriers: p.carriers || 0,
            submarines: p.submarines || 0,
            patrol: p.patrol || 0,
            auxiliaryVessels: p.auxiliaryVessels || 0,
            totalVessels: p.totalVessels || 0,
          };
        }
      }
      localStorage.setItem('wm:vesselPosture', JSON.stringify({ counts, ts: Date.now() }));
    } catch { /* quota exceeded or private mode */ }
  }

  private restoreVesselCounts(): void {
    try {
      const raw = localStorage.getItem('wm:vesselPosture');
      if (!raw) return;
      const { counts, ts } = JSON.parse(raw);
      // Only use cache if < 30 minutes old
      if (Date.now() - ts > 30 * 60 * 1000) return;
      for (const p of this.postures) {
        const cached = counts[p.theaterId];
        if (cached) {
          p.destroyers = cached.destroyers;
          p.frigates = cached.frigates;
          p.carriers = cached.carriers;
          p.submarines = cached.submarines;
          p.patrol = cached.patrol;
          p.auxiliaryVessels = cached.auxiliaryVessels;
          p.totalVessels = cached.totalVessels;
        }
      }
    } catch { /* parse error */ }
  }

  public updatePostures(data: CachedTheaterPosture): void {
    if (!data || data.postures.length === 0) {
      this.showNoData();
      return;
    }
    // Deep clone to avoid mutating cached data
    this.postures = data.postures.map((p) => ({
      ...p,
      byOperator: { ...p.byOperator },
    }));
    this.lastTimestamp = data.timestamp;
    this.isStale = data.stale || false;
    this.augmentWithVessels().then(() => {
      this.updateBadges();
      this.render();
    });
  }

  private updateBadges(): void {
    const hasCritical = this.postures.some((p) => p.postureLevel === 'critical');
    const hasElevated = this.postures.some((p) => p.postureLevel === 'elevated');
    if (hasCritical) {
      this.setNewBadge(1, true);
    } else if (hasElevated) {
      this.setNewBadge(1, false);
    } else {
      this.clearNewBadge();
    }
  }

  public refresh(): void {
    this.fetchAndRender();
  }

  private showNoData(): void {
    this.stopLoadingTimer();
    this.setContent(`
      <div class="sector-panel">
        <div class="sector-no-data">
          <div class="sector-no-data-icon pulse">📡</div>
          <div class="sector-no-data-title">Acquiring Data</div>
          <div class="sector-no-data-desc">
            Connecting to on-chain data feeds.
            This may take 30-60 seconds on first load.
          </div>
          <div class="sector-data-sources">
            <div class="sector-source">
              <span class="sector-source-icon connecting">💸</span>
              <span>Whale Transaction Feed</span>
            </div>
            <div class="sector-source">
              <span class="sector-source-icon waiting">🔗</span>
              <span>Protocol Signal Stream</span>
            </div>
          </div>
          <button class="sector-retry-btn">↻ Retry Now</button>
        </div>
      </div>
    `);
    this.content.querySelector('.sector-retry-btn')?.addEventListener('click', () => this.refresh());
  }

  private showFetchError(): void {
    this.stopLoadingTimer();
    this.setContent(`
      <div class="sector-panel">
        <div class="sector-no-data">
          <div class="sector-no-data-icon">⚠️</div>
          <div class="sector-no-data-title">Feed Rate Limited</div>
          <div class="sector-no-data-desc">
            OpenSky API has request limits. The panel will automatically
            retry in a few minutes, or you can try again now.
          </div>
          <div class="sector-error-hint">
            <strong>Tip:</strong> Peak hours (UTC 12:00-20:00) often see higher limits.
          </div>
          <button class="sector-retry-btn">↻ Try Again</button>
        </div>
      </div>
    `);
    this.content.querySelector('.sector-retry-btn')?.addEventListener('click', () => this.refresh());
  }

  private getPostureBadge(level: string): string {
    switch (level) {
      case 'critical':
        return '<span class="sector-badge sector-critical">CRIT</span>';
      case 'elevated':
        return '<span class="sector-badge sector-elevated">ELEV</span>';
      default:
        return '<span class="sector-badge sector-normal">NORM</span>';
    }
  }

  private getTrendIcon(trend: string, change: number): string {
    switch (trend) {
      case 'increasing':
        return `<span class="sector-trend trend-up">↗ +${change}%</span>`;
      case 'decreasing':
        return `<span class="sector-trend trend-down">↘ ${change}%</span>`;
      default:
        return '<span class="sector-trend trend-stable">→ stable</span>';
    }
  }

  private renderTheater(p: TheaterPostureSummary): string {
    const isExpanded = p.postureLevel !== 'normal';

    if (!isExpanded) {
      // Compact single-line view for normal theaters
      const chips: string[] = [];
      if (p.totalAircraft > 0) chips.push(`<span class="sector-chip air">💸 ${p.totalAircraft}</span>`);
      if (p.totalVessels > 0) chips.push(`<span class="sector-chip naval">🔗 ${p.totalVessels}</span>`);

      return `
        <div class="sector-region sector-compact" data-lat="${p.centerLat}" data-lon="${p.centerLon}" title="Click to view ${escapeHtml(p.theaterName)} on map">
          <span class="sector-name">${escapeHtml(p.shortName)}</span>
          <div class="sector-chips">${chips.join('')}</div>
          ${this.getPostureBadge(p.postureLevel)}
          <button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: p.theaterName, description: 'Posture: ' + p.postureLevel + ' \u2022 TXs: ' + p.totalAircraft + ' \u2022 Protocols: ' + p.totalVessels, category: 'sector-overview', lat: p.centerLat, lon: p.centerLon }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6" title="View details">ℹ</button>
        </div>
      `;
    }

    // Build compact stat chips for expanded view
    const airChips: string[] = [];
    if (p.fighters > 0) airChips.push(`<span class="sector-stat" title="Swaps">🔄 ${p.fighters}</span>`);
    if (p.tankers > 0) airChips.push(`<span class="sector-stat" title="Liquidity">💧 ${p.tankers}</span>`);
    if (p.awacs > 0) airChips.push(`<span class="sector-stat" title="Oracle Updates">📡 ${p.awacs}</span>`);
    if (p.reconnaissance > 0) airChips.push(`<span class="sector-stat" title="Scans">🔍 ${p.reconnaissance}</span>`);
    if (p.transport > 0) airChips.push(`<span class="sector-stat" title="Transfers">📦 ${p.transport}</span>`);
    if (p.bombers > 0) airChips.push(`<span class="sector-stat" title="Large TXs">💰 ${p.bombers}</span>`);
    if (p.drones > 0) airChips.push(`<span class="sector-stat" title="Bots">🤖 ${p.drones}</span>`);
    // Fallback: show total transactions if no typed breakdown available
    if (airChips.length === 0 && p.totalAircraft > 0) {
      airChips.push(`<span class="sector-stat" title="Transactions">💸 ${p.totalAircraft}</span>`);
    }

    const navalChips: string[] = [];
    if (p.carriers > 0) navalChips.push(`<span class="sector-stat carrier" title="Vaults">🏦 ${p.carriers}</span>`);
    if (p.destroyers > 0) navalChips.push(`<span class="sector-stat" title="Liquidators">⚡ ${p.destroyers}</span>`);
    if (p.frigates > 0) navalChips.push(`<span class="sector-stat" title="Aggregators">🔀 ${p.frigates}</span>`);
    if (p.submarines > 0) navalChips.push(`<span class="sector-stat" title="Dark Pools">🦈 ${p.submarines}</span>`);
    if (p.patrol > 0) navalChips.push(`<span class="sector-stat" title="Monitors">👁️ ${p.patrol}</span>`);
    if (p.auxiliaryVessels > 0) navalChips.push(`<span class="sector-stat" title="Relays">📡 ${p.auxiliaryVessels}</span>`);
    // Fallback: show total protocols if no typed breakdown available
    if (navalChips.length === 0 && p.totalVessels > 0) {
      navalChips.push(`<span class="sector-stat" title="Protocols">🔗 ${p.totalVessels}</span>`);
    }

    const hasAir = airChips.length > 0;
    const hasNaval = navalChips.length > 0;

    return `
      <div class="sector-region sector-expanded ${p.postureLevel}" data-lat="${p.centerLat}" data-lon="${p.centerLon}" title="Click to view on map">
        <div class="sector-region-header">
          <span class="sector-name">${escapeHtml(p.theaterName)}</span>
          ${this.getPostureBadge(p.postureLevel)}
        </div>

        <div class="sector-forces">
          ${hasAir ? `<div class="sector-force-row"><span class="sector-domain">TXS</span><div class="sector-stats">${airChips.join('')}</div></div>` : ''}
          ${hasNaval ? `<div class="sector-force-row"><span class="sector-domain">PROTO</span><div class="sector-stats">${navalChips.join('')}</div></div>` : ''}
        </div>

        <div class="sector-footer">
          ${p.strikeCapable ? '<span class="sector-strike">⚡ HIGH RISK</span>' : ''}
          ${this.getTrendIcon(p.trend, p.changePercent)}
          ${p.targetNation ? `<span class="sector-focus">→ ${escapeHtml(p.targetNation)}</span>` : ''}
          <button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: p.theaterName, description: 'Posture: ' + p.postureLevel + ' \u2022 TXs: ' + p.totalAircraft + ' \u2022 Protocols: ' + p.totalVessels + (p.strikeCapable ? ' \u2022 HIGH RISK' : '') + (p.targetNation ? ' \u2022 Focus: ' + p.targetNation : ''), category: 'sector-overview', lat: p.centerLat, lon: p.centerLon }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6" title="View details">ℹ</button>
        </div>
      </div>
    `;
  }

  private render(): void {
    this.stopLoadingTimer();
    const sorted = [...this.postures].sort((a, b) => {
      const order: Record<string, number> = { critical: 0, elevated: 1, normal: 2 };
      return (order[a.postureLevel] ?? 2) - (order[b.postureLevel] ?? 2);
    });

    const updatedTime = this.lastTimestamp
      ? new Date(this.lastTimestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    const staleWarning = this.isStale
      ? '<div class="sector-stale-warning">⚠️ Using cached data - live feed temporarily unavailable</div>'
      : '';

    const html = `
      <div class="sector-panel">
        ${staleWarning}
        ${sorted.map((p) => this.renderTheater(p)).join('')}

        <div class="sector-footer">
          <span class="sector-updated">${this.isStale ? '⚠️ ' : ''}Updated: ${updatedTime}</span>
          <button class="sector-refresh-btn" title="Refresh">↻</button>
        </div>
      </div>
    `;

    this.setContent(html);
    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    this.content.querySelector('.sector-refresh-btn')?.addEventListener('click', () => {
      this.refresh();
    });

    const theaters = this.content.querySelectorAll('.sector-region');
    theaters.forEach((el) => {
      el.addEventListener('click', () => {
        const lat = parseFloat((el as HTMLElement).dataset.lat || '0');
        const lon = parseFloat((el as HTMLElement).dataset.lon || '0');
        if (this.onLocationClick && !isNaN(lat) && !isNaN(lon)) {
          this.onLocationClick(lat, lon);
        }
      });
    });

    // Delegated click handler for detail:open buttons
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.detail-open-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(btn.getAttribute('data-detail-event') || '{}');
        window.dispatchEvent(new CustomEvent('detail:open', { detail: { type: 'event', data } }));
      } catch { /* ignore parse errors */ }
    });
  }

  public setLocationClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onLocationClick = handler;
  }

  public getPostures(): TheaterPostureSummary[] {
    return this.postures;
  }

  public destroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.stopLoadingTimer();
    this.vesselTimeouts.forEach(t => clearTimeout(t));
    this.vesselTimeouts = [];
    super.destroy();
  }
}
