import type { RiskRegion, Hotspot, Earthquake, NewsItem, TrackedFacility, KeyWaterway, APTGroup, EnergyFacility, EconomicCenter, GammaIrradiator, Pipeline, UnderseaCable, CableAdvisory, RepairShip, InternetOutage, AIDataCenter, AisDisruptionEvent, SocialUnrestEvent, AirportDelayAlert, TrackedFlight, TrackedVessel, FlightCluster, VesselCluster, NaturalEvent, Port, Spaceport, CriticalMineralProject, SecurityThreat, BridgeFlow } from '@/types';
import type { WeatherAlert } from '@/services/weather';
import { UNDERSEA_CABLES } from '@/config';
import type { StartupHub, Accelerator, TechHQ, CloudRegion } from '@/config/tech-geo';
import type { CryptoExchange } from '@/config/crypto-exchanges';
import type { TechHubActivity } from '@/services/tech-activity';
import type { GeoHubActivity } from '@/services/geo-activity';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { isMobileDevice } from '@/utils';
import { fetchHotspotContext, formatArticleDate, extractDomain, type GdeltArticle } from '@/services/gdelt-intel';
import { getNaturalEventIcon } from '@/services/eonet';
import { getHotspotEscalation, getEscalationChange24h } from '@/services/hotspot-escalation';

export type PopupType = 'risk' | 'trend' | 'earthquake' | 'weather' | 'base' | 'waterway' | 'apt' | 'cyberThreat' | 'nuclear' | 'economic' | 'irradiator' | 'pipeline' | 'cable' | 'cable-advisory' | 'repair-ship' | 'outage' | 'datacenter' | 'datacenterCluster' | 'ais' | 'event' | 'eventCluster' | 'flight' | 'militaryFlight' | 'militaryVessel' | 'militaryFlightCluster' | 'militaryVesselCluster' | 'natEvent' | 'port' | 'spaceport' | 'mineral' | 'startupHub' | 'cloudRegion' | 'techHQ' | 'accelerator' | 'techEvent' | 'techHQCluster' | 'techEventCluster' | 'techActivity' | 'geoActivity' | 'protestCluster' | 'exchange' | 'bridgeFlow';

interface TechEventPopupData {
  id: string;
  title: string;
  location: string;
  lat: number;
  lng: number;
  country: string;
  startDate: string;
  endDate: string;
  url: string | null;
  daysUntil: number;
}

interface TechHQClusterData {
  items: TechHQ[];
  city: string;
  country: string;
  count?: number;
  faangCount?: number;
  unicornCount?: number;
  publicCount?: number;
  sampled?: boolean;
}

interface TechEventClusterData {
  items: TechEventPopupData[];
  location: string;
  country: string;
  count?: number;
  soonCount?: number;
  sampled?: boolean;
}

interface ProtestClusterData {
  items: SocialUnrestEvent[];
  country: string;
  count?: number;
  riotCount?: number;
  highSeverityCount?: number;
  verifiedCount?: number;
  totalFatalities?: number;
  sampled?: boolean;
}

interface DatacenterClusterData {
  items: AIDataCenter[];
  region: string;
  country: string;
  count?: number;
  totalChips?: number;
  totalPowerMW?: number;
  existingCount?: number;
  plannedCount?: number;
  sampled?: boolean;
}

interface PopupData {
  type: PopupType;
  data: RiskRegion | Hotspot | Earthquake | WeatherAlert | TrackedFacility | KeyWaterway | APTGroup | SecurityThreat | EnergyFacility | EconomicCenter | GammaIrradiator | Pipeline | UnderseaCable | CableAdvisory | RepairShip | InternetOutage | AIDataCenter | AisDisruptionEvent | SocialUnrestEvent | AirportDelayAlert | TrackedFlight | TrackedVessel | FlightCluster | VesselCluster | NaturalEvent | Port | Spaceport | CriticalMineralProject | StartupHub | CloudRegion | TechHQ | Accelerator | TechEventPopupData | TechHQClusterData | TechEventClusterData | ProtestClusterData | DatacenterClusterData | TechHubActivity | GeoHubActivity | CryptoExchange | BridgeFlow;
  relatedNews?: NewsItem[];
  x: number;
  y: number;
}

export class MapPopup {
  private container: HTMLElement;
  private popup: HTMLElement | null = null;
  private onClose?: () => void;
  private cableAdvisories: CableAdvisory[] = [];
  private repairShips: RepairShip[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public show(data: PopupData): void {
    this.hide();

    this.popup = document.createElement('div');
    this.popup.className = 'map-popup';

    const content = this.renderContent(data);
    this.popup.innerHTML = content;

    // Get container's viewport position for absolute positioning
    const containerRect = this.container.getBoundingClientRect();

    if (isMobileDevice()) {
      // On mobile, center the popup horizontally and position in upper area
      this.popup.style.left = '50%';
      this.popup.style.transform = 'translateX(-50%)';
      this.popup.style.top = `${Math.max(60, Math.min(containerRect.top + data.y, window.innerHeight * 0.4))}px`;
    } else {
      // Desktop: position near click with smart bounds checking
      this.popup.style.transform = '';
      const popupWidth = 380;
      const bottomBuffer = 50; // Buffer from viewport bottom
      const topBuffer = 60; // Header height

      // Temporarily append popup off-screen to measure actual height
      this.popup.style.visibility = 'hidden';
      this.popup.style.top = '0';
      this.popup.style.left = '-9999px';
      document.body.appendChild(this.popup);
      const popupHeight = this.popup.offsetHeight;
      document.body.removeChild(this.popup);
      this.popup.style.visibility = '';

      // Convert container-relative coords to viewport coords
      const viewportX = containerRect.left + data.x;
      const viewportY = containerRect.top + data.y;

      // Horizontal positioning (viewport-relative)
      const maxX = window.innerWidth - popupWidth - 20;
      let left = viewportX + 20;
      if (left > maxX) {
        // Position to the left of click if it would overflow right
        left = Math.max(10, viewportX - popupWidth - 20);
      }

      // Vertical positioning - prefer below click, but flip above if needed
      const availableBelow = window.innerHeight - viewportY - bottomBuffer;
      const availableAbove = viewportY - topBuffer;

      let top: number;
      if (availableBelow >= popupHeight) {
        // Enough space below - position below click
        top = viewportY + 10;
      } else if (availableAbove >= popupHeight) {
        // Not enough below, but enough above - position above click
        top = viewportY - popupHeight - 10;
      } else {
        // Limited space both ways - position at top buffer
        top = topBuffer;
      }

      // CRITICAL: Ensure popup never goes above the top buffer (header area)
      top = Math.max(topBuffer, top);

      this.popup.style.left = `${left}px`;
      this.popup.style.top = `${top}px`;
    }

    // Append to body to avoid container overflow clipping
    document.body.appendChild(this.popup);

    // Close button handler
    this.popup.querySelector('.popup-close')?.addEventListener('click', () => this.hide());

    // Wire "More Details" button to open DetailPanel
    const detailPayload = this.buildDetailPayload(data);
    if (detailPayload) {
      const popupBody = this.popup.querySelector('.popup-body');
      if (popupBody) {
        const btnWrapper = document.createElement('div');
        btnWrapper.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08);margin-top:8px;padding-top:8px';
        btnWrapper.innerHTML = `<button class="popup-detail-btn" style="width:100%;padding:6px 12px;background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);border-radius:6px;color:#60a5fa;font-size:12px;cursor:pointer;transition:background 0.2s">More Details ↗</button>`;
        popupBody.appendChild(btnWrapper);

        btnWrapper.querySelector('.popup-detail-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('detail:open', { detail: detailPayload }));
          this.hide();
        });
      }
    }

    // Click outside to close
    setTimeout(() => {
      document.addEventListener('click', this.handleOutsideClick);
    }, 100);
  }

  private handleOutsideClick = (e: MouseEvent) => {
    if (this.popup && !this.popup.contains(e.target as Node)) {
      this.hide();
    }
  };

  /** Show a popup with raw HTML content (no typed data). Used for custom layer popups. */
  public showRaw(html: string, x: number, y: number): void {
    this.hide();
    this.popup = document.createElement('div');
    this.popup.className = 'map-popup';
    this.popup.innerHTML = html;

    const containerRect = this.container.getBoundingClientRect();
    if (isMobileDevice()) {
      this.popup.style.left = '50%';
      this.popup.style.transform = 'translateX(-50%)';
      this.popup.style.top = `${Math.max(60, Math.min(containerRect.top + y, window.innerHeight * 0.4))}px`;
    } else {
      this.popup.style.transform = '';
      const popupWidth = 380;
      const bottomBuffer = 50;
      const topBuffer = 60;
      this.popup.style.visibility = 'hidden';
      this.popup.style.top = '0';
      this.popup.style.left = '-9999px';
      document.body.appendChild(this.popup);
      const popupHeight = this.popup.offsetHeight;
      document.body.removeChild(this.popup);
      this.popup.style.visibility = '';
      const viewportX = containerRect.left + x;
      const viewportY = containerRect.top + y;
      const maxX = window.innerWidth - popupWidth - 20;
      let left = viewportX + 20;
      if (left > maxX) left = Math.max(10, viewportX - popupWidth - 20);
      const availableBelow = window.innerHeight - viewportY - bottomBuffer;
      const availableAbove = viewportY - topBuffer;
      let top: number;
      if (availableBelow >= popupHeight) top = viewportY + 10;
      else if (availableAbove >= popupHeight) top = viewportY - popupHeight - 10;
      else top = topBuffer;
      top = Math.max(topBuffer, top);
      this.popup.style.left = `${left}px`;
      this.popup.style.top = `${top}px`;
    }
    document.body.appendChild(this.popup);
    this.popup.querySelector('.popup-close')?.addEventListener('click', () => this.hide());
    setTimeout(() => { document.addEventListener('click', this.handleOutsideClick); }, 100);
  }

  public hide(): void {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
      document.removeEventListener('click', this.handleOutsideClick);
      this.onClose?.();
    }
  }

  public setOnClose(callback: () => void): void {
    this.onClose = callback;
  }

  public setCableActivity(advisories: CableAdvisory[], repairShips: RepairShip[]): void {
    this.cableAdvisories = advisories;
    this.repairShips = repairShips;
  }

  private renderContent(data: PopupData): string {
    switch (data.type) {
      case 'risk':
        return this.renderConflictPopup(data.data as RiskRegion);
      case 'trend':
        return this.renderHotspotPopup(data.data as Hotspot, data.relatedNews);
      case 'earthquake':
        return this.renderEarthquakePopup(data.data as Earthquake);
      case 'weather':
        return this.renderWeatherPopup(data.data as WeatherAlert);
      case 'base':
        return this.renderBasePopup(data.data as TrackedFacility);
      case 'waterway':
        return this.renderWaterwayPopup(data.data as KeyWaterway);
      case 'apt':
        return this.renderAPTPopup(data.data as APTGroup);
      case 'cyberThreat':
        return this.renderCyberThreatPopup(data.data as SecurityThreat);
      case 'nuclear':
        return this.renderNuclearPopup(data.data as EnergyFacility);
      case 'economic':
        return this.renderEconomicPopup(data.data as EconomicCenter);
      case 'irradiator':
        return this.renderIrradiatorPopup(data.data as GammaIrradiator);
      case 'pipeline':
        return this.renderPipelinePopup(data.data as Pipeline);
      case 'cable':
        return this.renderCablePopup(data.data as UnderseaCable);
      case 'cable-advisory':
        return this.renderCableAdvisoryPopup(data.data as CableAdvisory);
      case 'repair-ship':
        return this.renderRepairShipPopup(data.data as RepairShip);
      case 'outage':
        return this.renderOutagePopup(data.data as InternetOutage);
      case 'datacenter':
        return this.renderDatacenterPopup(data.data as AIDataCenter);
      case 'datacenterCluster':
        return this.renderDatacenterClusterPopup(data.data as DatacenterClusterData);
      case 'ais':
        return this.renderAisPopup(data.data as AisDisruptionEvent);
      case 'event':
        return this.renderProtestPopup(data.data as SocialUnrestEvent);
      case 'eventCluster':
        return this.renderProtestClusterPopup(data.data as ProtestClusterData);
      case 'flight':
        return this.renderFlightPopup(data.data as AirportDelayAlert);
      case 'militaryFlight':
        return this.renderMilitaryFlightPopup(data.data as TrackedFlight);
      case 'militaryVessel':
        return this.renderMilitaryVesselPopup(data.data as TrackedVessel);
      case 'militaryFlightCluster':
        return this.renderMilitaryFlightClusterPopup(data.data as FlightCluster);
      case 'militaryVesselCluster':
        return this.renderMilitaryVesselClusterPopup(data.data as VesselCluster);
      case 'natEvent':
        return this.renderNaturalEventPopup(data.data as NaturalEvent);
      case 'port':
        return this.renderPortPopup(data.data as Port);
      case 'spaceport':
        return this.renderSpaceportPopup(data.data as Spaceport);
      case 'mineral':
        return this.renderMineralPopup(data.data as CriticalMineralProject);
      case 'startupHub':
        return this.renderStartupHubPopup(data.data as StartupHub);
      case 'cloudRegion':
        return this.renderCloudRegionPopup(data.data as CloudRegion);
      case 'techHQ':
        return this.renderTechHQPopup(data.data as TechHQ);
      case 'accelerator':
        return this.renderAcceleratorPopup(data.data as Accelerator);
      case 'techEvent':
        return this.renderTechEventPopup(data.data as TechEventPopupData);
      case 'techHQCluster':
        return this.renderTechHQClusterPopup(data.data as TechHQClusterData);
      case 'techEventCluster':
        return this.renderTechEventClusterPopup(data.data as TechEventClusterData);
      case 'bridgeFlow':
        return this.renderBridgeFlowPopup(data.data as unknown as BridgeFlow);
      case 'exchange':
        return this.renderExchangePopup(data.data as CryptoExchange);
      default:
        return '';
    }
  }

  private renderExchangePopup(exchange: CryptoExchange): string {
    const statusColors: Record<string, string> = {
      licensed: 'normal',
      restricted: 'elevated',
      banned: 'critical',
      unregulated: 'low',
      relocated: 'elevated',
    };
    const statusLabels: Record<string, string> = {
      licensed: 'LICENSED',
      restricted: 'RESTRICTED',
      banned: 'BANNED',
      unregulated: 'UNREGULATED',
      relocated: 'RELOCATED',
    };
    const typeIcons: Record<string, string> = {
      cex: '🏦',
      dex: '🔗',
      hybrid: '⚡',
    };
    const typeLabels: Record<string, string> = {
      cex: 'CEX',
      dex: 'DEX',
      hybrid: 'HYBRID',
    };

    const formatVolume = (v?: number) => {
      if (!v) return 'N/A';
      if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
      if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
      return `$${(v / 1e3).toFixed(0)}K`;
    };

    return `
      <div class="popup-header" style="background: linear-gradient(135deg, rgba(0,200,83,0.2), rgba(0,100,50,0.2));">
        <span class="popup-title">${typeIcons[exchange.type] || '🏦'} ${escapeHtml(exchange.name)}</span>
        <span class="popup-badge ${statusColors[exchange.status] || 'normal'}">${statusLabels[exchange.status] || 'UNKNOWN'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(exchange.city)}, ${escapeHtml(exchange.country)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">${typeLabels[exchange.type] || exchange.type.toUpperCase()}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">FOUNDED</span>
            <span class="stat-value">${exchange.founded}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">24H VOLUME</span>
            <span class="stat-value">${formatVolume(exchange.volume24h)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">STATUS</span>
            <span class="stat-value" style="color:${exchange.status === 'licensed' ? '#00c853' : exchange.status === 'banned' ? '#ff3c3c' : '#ffc800'};">${statusLabels[exchange.status] || 'UNKNOWN'}</span>
          </div>
        </div>
        ${exchange.note ? `<p class="popup-description">${escapeHtml(exchange.note)}</p>` : ''}
        <div class="popup-attribution">
          <a href="${escapeHtml(exchange.url)}" target="_blank" rel="noopener noreferrer" style="color:#4488ff;text-decoration:none;font-size:11px;">${escapeHtml(exchange.url)} ↗</a>
        </div>
      </div>
    `;
  }

  private renderConflictPopup(conflict: RiskRegion): string {
    const severityClass = conflict.intensity === 'high' ? 'high' : conflict.intensity === 'medium' ? 'medium' : 'low';
    const severityLabel = escapeHtml(conflict.intensity?.toUpperCase() || 'UNKNOWN');

    return `
      <div class="popup-header risk">
        <span class="popup-title">${escapeHtml(conflict.name.toUpperCase())}</span>
        <span class="popup-badge ${severityClass}">${severityLabel}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">START DATE</span>
            <span class="stat-value">${escapeHtml(conflict.startDate || 'Unknown')}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">LOSSES</span>
            <span class="stat-value">${escapeHtml(conflict.casualties || 'Unknown')}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">AFFECTED USERS</span>
            <span class="stat-value">${escapeHtml(conflict.displaced || 'Unknown')}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">LOCATION</span>
            <span class="stat-value">${escapeHtml(conflict.location || `${conflict.center[1]}°N, ${conflict.center[0]}°E`)}</span>
          </div>
        </div>
        ${conflict.description ? `<p class="popup-description">${escapeHtml(conflict.description)}</p>` : ''}
        ${conflict.parties && conflict.parties.length > 0 ? `
          <div class="popup-section">
            <span class="section-label">PARTIES</span>
            <div class="popup-tags">
              ${conflict.parties.map(p => `<span class="popup-tag">${escapeHtml(p)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        ${conflict.keyDevelopments && conflict.keyDevelopments.length > 0 ? `
          <div class="popup-section">
            <span class="section-label">KEY DEVELOPMENTS</span>
            <ul class="popup-list">
              ${conflict.keyDevelopments.map(d => `<li>${escapeHtml(d)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderHotspotPopup(hotspot: Hotspot, relatedNews?: NewsItem[]): string {
    const severityClass = hotspot.level || 'low';
    const severityLabel = escapeHtml((hotspot.level || 'low').toUpperCase());

    // Get dynamic escalation score
    const dynamicScore = getHotspotEscalation(hotspot.id);
    const change24h = getEscalationChange24h(hotspot.id);

    // Escalation score display
    const escalationColors: Record<number, string> = { 1: '#44aa44', 2: '#88aa44', 3: '#ffaa00', 4: '#ff6600', 5: '#ff2222' };
    const escalationLabels: Record<number, string> = { 1: 'STABLE', 2: 'WATCH', 3: 'ELEVATED', 4: 'HIGH', 5: 'CRITICAL' };
    const trendIcons: Record<string, string> = { 'escalating': '↑', 'stable': '→', 'de-escalating': '↓' };
    const trendColors: Record<string, string> = { 'escalating': '#ff4444', 'stable': '#ffaa00', 'de-escalating': '#44aa44' };

    const displayScore = dynamicScore?.combinedScore ?? hotspot.escalationScore ?? 3;
    const displayScoreInt = Math.round(displayScore);
    const displayTrend = dynamicScore?.trend ?? hotspot.escalationTrend ?? 'stable';

    const escalationSection = `
      <div class="popup-section escalation-section">
        <span class="section-label">ESCALATION ASSESSMENT</span>
        <div class="escalation-display">
          <div class="escalation-score" style="background: ${escalationColors[displayScoreInt] || '#888'}">
            <span class="score-value">${displayScore.toFixed(1)}/5</span>
            <span class="score-label">${escalationLabels[displayScoreInt] || 'UNKNOWN'}</span>
          </div>
          <div class="escalation-trend" style="color: ${trendColors[displayTrend] || '#888'}">
            <span class="trend-icon">${trendIcons[displayTrend] || ''}</span>
            <span class="trend-label">${escapeHtml(displayTrend.toUpperCase())}</span>
          </div>
        </div>
        ${dynamicScore ? `
          <div class="escalation-breakdown">
            <div class="breakdown-header">
              <span class="baseline-label">Baseline: ${dynamicScore.staticBaseline}/5</span>
              ${change24h ? `
                <span class="change-label ${change24h.change >= 0 ? 'rising' : 'falling'}">
                  24h: ${change24h.change >= 0 ? '+' : ''}${change24h.change}
                </span>
              ` : ''}
            </div>
            <div class="breakdown-components">
              <div class="breakdown-row">
                <span class="component-label">News</span>
                <div class="component-bar-bg">
                  <div class="component-bar news" style="width: ${dynamicScore.components.newsActivity}%"></div>
                </div>
                <span class="component-value">${Math.round(dynamicScore.components.newsActivity)}</span>
              </div>
              <div class="breakdown-row">
                <span class="component-label">Risk</span>
                <div class="component-bar-bg">
                  <div class="component-bar cri" style="width: ${dynamicScore.components.riskContribution}%"></div>
                </div>
                <span class="component-value">${Math.round(dynamicScore.components.riskContribution)}</span>
              </div>
              <div class="breakdown-row">
                <span class="component-label">Geo</span>
                <div class="component-bar-bg">
                  <div class="component-bar geo" style="width: ${dynamicScore.components.geoConvergence}%"></div>
                </div>
                <span class="component-value">${Math.round(dynamicScore.components.geoConvergence)}</span>
              </div>
              <div class="breakdown-row">
                <span class="component-label">Whales</span>
                <div class="component-bar-bg">
                  <div class="component-bar military" style="width: ${dynamicScore.components.whaleActivity}%"></div>
                </div>
                <span class="component-value">${Math.round(dynamicScore.components.whaleActivity)}</span>
              </div>
            </div>
          </div>
        ` : ''}
        ${hotspot.escalationIndicators && hotspot.escalationIndicators.length > 0 ? `
          <div class="escalation-indicators">
            ${hotspot.escalationIndicators.map(i => `<span class="indicator-tag">• ${escapeHtml(i)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;

    // Historical context section
    const historySection = hotspot.history ? `
      <div class="popup-section history-section">
        <span class="section-label">HISTORICAL CONTEXT</span>
        <div class="history-content">
          ${hotspot.history.lastMajorEvent ? `
            <div class="history-event">
              <span class="history-label">Last Major Event:</span>
              <span class="history-value">${escapeHtml(hotspot.history.lastMajorEvent)} ${hotspot.history.lastMajorEventDate ? `(${escapeHtml(hotspot.history.lastMajorEventDate)})` : ''}</span>
            </div>
          ` : ''}
          ${hotspot.history.precedentDescription ? `
            <div class="history-event">
              <span class="history-label">Precedents:</span>
              <span class="history-value">${escapeHtml(hotspot.history.precedentDescription)}</span>
            </div>
          ` : ''}
          ${hotspot.history.cyclicalRisk ? `
            <div class="history-event cyclical">
              <span class="history-label">Cyclical Pattern:</span>
              <span class="history-value">${escapeHtml(hotspot.history.cyclicalRisk)}</span>
            </div>
          ` : ''}
        </div>
      </div>
    ` : '';

    // "Why it matters" section
    const whyItMattersSection = hotspot.whyItMatters ? `
      <div class="popup-section why-matters-section">
        <span class="section-label">WHY IT MATTERS</span>
        <p class="why-matters-text">${escapeHtml(hotspot.whyItMatters)}</p>
      </div>
    ` : '';

    return `
      <div class="popup-header trend">
        <span class="popup-title">${escapeHtml(hotspot.name.toUpperCase())}</span>
        <span class="popup-badge ${severityClass}">${severityLabel}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        ${hotspot.subtext ? `<div class="popup-subtitle">${escapeHtml(hotspot.subtext)}</div>` : ''}
        ${hotspot.description ? `<p class="popup-description">${escapeHtml(hotspot.description)}</p>` : ''}
        ${escalationSection}
        <div class="popup-stats">
          ${hotspot.location ? `
            <div class="popup-stat">
              <span class="stat-label">LOCATION</span>
              <span class="stat-value">${escapeHtml(hotspot.location)}</span>
            </div>
          ` : ''}
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${escapeHtml(`${hotspot.lat.toFixed(2)}°N, ${hotspot.lon.toFixed(2)}°E`)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">STATUS</span>
            <span class="stat-value">${escapeHtml(hotspot.status || 'Monitoring')}</span>
          </div>
        </div>
        ${whyItMattersSection}
        ${historySection}
        ${hotspot.agencies && hotspot.agencies.length > 0 ? `
          <div class="popup-section">
            <span class="section-label">KEY ENTITIES</span>
            <div class="popup-tags">
              ${hotspot.agencies.map(a => `<span class="popup-tag">${escapeHtml(a)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        ${relatedNews && relatedNews.length > 0 ? `
          <div class="popup-section">
            <span class="section-label">RELATED HEADLINES</span>
            <div class="popup-news">
              ${relatedNews.slice(0, 5).map(n => `
                <div class="popup-news-item">
                  <span class="news-source">${escapeHtml(n.source)}</span>
                  <a href="${sanitizeUrl(n.link)}" target="_blank" class="news-title">${escapeHtml(n.title)}</a>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div class="trend-gdelt-context" data-hotspot-id="${escapeHtml(hotspot.id)}">
          <div class="trend-gdelt-header">Live Market Intel</div>
          <div class="trend-gdelt-loading">Loading crypto news...</div>
        </div>
      </div>
    `;
  }

  public async loadHotspotGdeltContext(hotspot: Hotspot): Promise<void> {
    if (!this.popup) return;

    const container = this.popup.querySelector('.trend-gdelt-context');
    if (!container) return;

    try {
      const articles = await fetchHotspotContext(hotspot);

      if (!this.popup || !container.isConnected) return;

      if (articles.length === 0) {
        container.innerHTML = `
          <div class="trend-gdelt-header">Live Market Intel</div>
          <div class="trend-gdelt-loading">No recent coverage</div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="trend-gdelt-header">Live Market Intel</div>
        <div class="trend-gdelt-articles">
          ${articles.slice(0, 5).map(article => this.renderGdeltArticle(article)).join('')}
        </div>
      `;
    } catch (error) {
      if (container.isConnected) {
        container.innerHTML = `
          <div class="trend-gdelt-header">Live Market Intel</div>
          <div class="trend-gdelt-loading">Failed to load</div>
        `;
      }
    }
  }

  private renderGdeltArticle(article: GdeltArticle): string {
    const domain = article.source || extractDomain(article.url);
    const timeAgo = formatArticleDate(article.date);

    return `
      <a href="${sanitizeUrl(article.url)}" target="_blank" rel="noopener" class="trend-gdelt-article">
        <div class="article-meta">
          <span>${escapeHtml(domain)}</span>
          <span>${escapeHtml(timeAgo)}</span>
        </div>
        <div class="article-title">${escapeHtml(article.title)}</div>
      </a>
    `;
  }

  private renderEarthquakePopup(earthquake: Earthquake): string {
    const severity = earthquake.magnitude >= 6 ? 'high' : earthquake.magnitude >= 5 ? 'medium' : 'low';
    const severityLabel = earthquake.magnitude >= 6 ? 'MAJOR' : earthquake.magnitude >= 5 ? 'MODERATE' : 'MINOR';

    const timeAgo = this.getTimeAgo(earthquake.time);

    return `
      <div class="popup-header earthquake">
        <span class="popup-title magnitude">M${earthquake.magnitude.toFixed(1)}</span>
        <span class="popup-badge ${severity}">${severityLabel}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <p class="popup-location">${escapeHtml(earthquake.place)}</p>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">Depth</span>
            <span class="stat-value">${earthquake.depth.toFixed(1)} km</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">Coordinates</span>
            <span class="stat-value">${earthquake.lat.toFixed(2)}°, ${earthquake.lon.toFixed(2)}°</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">Time</span>
            <span class="stat-value">${timeAgo}</span>
          </div>
        </div>
        <a href="${sanitizeUrl(earthquake.url)}" target="_blank" class="popup-link">View on USGS →</a>
      </div>
    `;
  }

  private getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  private renderWeatherPopup(alert: WeatherAlert): string {
    const severityClass = escapeHtml(alert.severity.toLowerCase());
    const expiresIn = this.getTimeUntil(alert.expires);

    return `
      <div class="popup-header weather ${severityClass}">
        <span class="popup-title">${escapeHtml(alert.event.toUpperCase())}</span>
        <span class="popup-badge ${severityClass}">${escapeHtml(alert.severity.toUpperCase())}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <p class="popup-headline">${escapeHtml(alert.headline)}</p>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">Area</span>
            <span class="stat-value">${escapeHtml(alert.areaDesc)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">Expires</span>
            <span class="stat-value">${expiresIn}</span>
          </div>
        </div>
        <p class="popup-description">${escapeHtml(alert.description.slice(0, 300))}${alert.description.length > 300 ? '...' : ''}</p>
      </div>
    `;
  }

  private getTimeUntil(date: Date): string {
    const ms = date.getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours < 1) return `${Math.floor(ms / (1000 * 60))}m`;
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  private renderBasePopup(base: TrackedFacility): string {
    const typeLabels: Record<string, string> = {
      'us-nato': 'TIER 1',
      'china': 'TIER 2',
      'russia': 'TIER 3',
    };
    const typeColors: Record<string, string> = {
      'us-nato': 'elevated',
      'china': 'high',
      'russia': 'high',
    };

    return `
      <div class="popup-header base">
        <span class="popup-title">${base.name.toUpperCase()}</span>
        <span class="popup-badge ${typeColors[base.type] || 'low'}">${typeLabels[base.type] || base.type.toUpperCase()}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        ${base.description ? `<p class="popup-description">${base.description}</p>` : ''}
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">${typeLabels[base.type] || base.type}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${base.lat.toFixed(2)}°, ${base.lon.toFixed(2)}°</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderWaterwayPopup(waterway: KeyWaterway): string {
    return `
      <div class="popup-header waterway">
        <span class="popup-title">${waterway.name}</span>
        <span class="popup-badge elevated">LIQUIDITY</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        ${waterway.description ? `<p class="popup-description">${waterway.description}</p>` : ''}
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${waterway.lat.toFixed(2)}°, ${waterway.lon.toFixed(2)}°</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderAisPopup(event: AisDisruptionEvent): string {
    const severityClass = escapeHtml(event.severity);
    const severityLabel = escapeHtml(event.severity.toUpperCase());
    const typeLabel = event.type === 'gap_spike' ? 'SIGNAL GAP SPIKE' : 'POOL CONGESTION';
    const changeLabel = event.type === 'gap_spike' ? 'SIGNAL LOSS' : 'DENSITY';
    const countLabel = event.type === 'gap_spike' ? 'DARK WALLETS' : 'TX COUNT';
    const countValue = event.type === 'gap_spike'
      ? event.darkShips?.toString() || '-'
      : event.vesselCount?.toString() || '-';

    return `
      <div class="popup-header ais">
        <span class="popup-title">${escapeHtml(event.name.toUpperCase())}</span>
        <span class="popup-badge ${severityClass}">${severityLabel}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${typeLabel}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">${changeLabel}</span>
            <span class="stat-value">${event.changePct}% ↑</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">${countLabel}</span>
            <span class="stat-value">${countValue}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">WINDOW</span>
            <span class="stat-value">${event.windowHours}H</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">REGION</span>
            <span class="stat-value">${escapeHtml(event.region || `${event.lat.toFixed(2)}°, ${event.lon.toFixed(2)}°`)}</span>
          </div>
        </div>
        <p class="popup-description">${escapeHtml(event.description)}</p>
      </div>
    `;
  }

  private renderProtestPopup(event: SocialUnrestEvent): string {
    const severityClass = escapeHtml(event.severity);
    const severityLabel = escapeHtml(event.severity.toUpperCase());
    const eventTypeLabel = escapeHtml(event.eventType.replace('_', ' ').toUpperCase());
    const icon = event.eventType === 'riot' ? '🔥' : event.eventType === 'strike' ? '✊' : '📢';
    const sourceLabel = event.sourceType === 'acled' ? 'On-chain (verified)' : 'GDELT';
    const validatedBadge = event.validated ? '<span class="popup-badge verified">VERIFIED</span>' : '';
    const fatalitiesSection = event.fatalities
      ? `<div class="popup-stat"><span class="stat-label">LOSSES</span><span class="stat-value alert">${event.fatalities}</span></div>`
      : '';
    const actorsSection = event.actors?.length
      ? `<div class="popup-stat"><span class="stat-label">PARTICIPANTS</span><span class="stat-value">${event.actors.map(a => escapeHtml(a)).join(', ')}</span></div>`
      : '';
    const tagsSection = event.tags?.length
      ? `<div class="popup-tags">${event.tags.map(t => `<span class="popup-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    const relatedHotspots = event.relatedHotspots?.length
      ? `<div class="popup-related">Near: ${event.relatedHotspots.map(h => escapeHtml(h)).join(', ')}</div>`
      : '';

    return `
      <div class="popup-header event ${severityClass}">
        <span class="popup-icon">${icon}</span>
        <span class="popup-title">${eventTypeLabel}</span>
        <span class="popup-badge ${severityClass}">${severityLabel}</span>
        ${validatedBadge}
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${event.city ? `${escapeHtml(event.city)}, ` : ''}${escapeHtml(event.country)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TIME</span>
            <span class="stat-value">${event.time.toLocaleDateString()}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">SOURCE</span>
            <span class="stat-value">${sourceLabel}</span>
          </div>
          ${fatalitiesSection}
          ${actorsSection}
        </div>
        ${event.title ? `<p class="popup-description">${escapeHtml(event.title)}</p>` : ''}
        ${tagsSection}
        ${relatedHotspots}
      </div>
    `;
  }

  private renderProtestClusterPopup(data: ProtestClusterData): string {
    const totalCount = data.count ?? data.items.length;
    const riots = data.riotCount ?? data.items.filter(e => e.eventType === 'riot').length;
    const highSeverity = data.highSeverityCount ?? data.items.filter(e => e.severity === 'high').length;
    const verified = data.verifiedCount ?? data.items.filter(e => e.validated).length;
    const totalFatalities = data.totalFatalities ?? data.items.reduce((sum, e) => sum + (e.fatalities || 0), 0);

    const sortedItems = [...data.items].sort((a, b) => {
      const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const typeOrder: Record<string, number> = { riot: 0, civil_unrest: 1, strike: 2, demonstration: 3, protest: 4 };
      const sevDiff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
      if (sevDiff !== 0) return sevDiff;
      return (typeOrder[a.eventType] ?? 5) - (typeOrder[b.eventType] ?? 5);
    });

    const listItems = sortedItems.slice(0, 10).map(event => {
      const icon = event.eventType === 'riot' ? '🔥' : event.eventType === 'strike' ? '✊' : '📢';
      const sevClass = event.severity;
      const dateStr = event.time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const city = event.city ? escapeHtml(event.city) : '';
      const title = event.title ? `: ${escapeHtml(event.title.slice(0, 40))}${event.title.length > 40 ? '...' : ''}` : '';
      return `<li class="cluster-item ${sevClass}">${icon} ${dateStr}${city ? ` • ${city}` : ''}${title}</li>`;
    }).join('');

    const renderedCount = Math.min(10, data.items.length);
    const remainingCount = Math.max(0, totalCount - renderedCount);
    const moreCount = remainingCount > 0 ? `<li class="cluster-more">+${remainingCount} more events</li>` : '';
    const headerClass = highSeverity > 0 ? 'high' : riots > 0 ? 'medium' : 'low';

    return `
      <div class="popup-header event ${headerClass} cluster">
        <span class="popup-title">📢 ${escapeHtml(data.country)}</span>
        <span class="popup-badge">${totalCount} EVENTS</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body cluster-popup">
        <div class="cluster-summary">
          ${riots ? `<span class="summary-item riot">🔥 ${riots} Riots</span>` : ''}
          ${highSeverity ? `<span class="summary-item high">⚠️ ${highSeverity} High Severity</span>` : ''}
          ${verified ? `<span class="summary-item verified">✓ ${verified} Verified</span>` : ''}
          ${totalFatalities > 0 ? `<span class="summary-item fatalities">💀 ${totalFatalities} Losses</span>` : ''}
        </div>
        <ul class="cluster-list">${listItems}${moreCount}</ul>
        ${data.sampled ? `<p class="popup-more">Showing a sampled list of ${data.items.length} events.</p>` : ''}
      </div>
    `;
  }

  private renderFlightPopup(delay: AirportDelayAlert): string {
    const severityClass = escapeHtml(delay.severity);
    const severityLabel = escapeHtml(delay.severity.toUpperCase());
    const delayTypeLabels: Record<string, string> = {
      'ground_stop': 'GROUND STOP',
      'ground_delay': 'GROUND DELAY PROGRAM',
      'departure_delay': 'DEPARTURE DELAYS',
      'arrival_delay': 'ARRIVAL DELAYS',
      'general': 'DELAYS REPORTED',
    };
    const delayTypeLabel = delayTypeLabels[delay.delayType] || 'DELAYS';
    const icon = delay.delayType === 'ground_stop' ? '🛑' : delay.severity === 'severe' ? '✈️' : '🛫';
    const sourceLabels: Record<string, string> = {
      'faa': 'FAA ASWS',
      'eurocontrol': 'Eurocontrol',
      'computed': 'Computed',
    };
    const sourceLabel = sourceLabels[delay.source] || escapeHtml(delay.source);
    const regionLabels: Record<string, string> = {
      'americas': 'Americas',
      'europe': 'Europe',
      'apac': 'Asia-Pacific',
      'mena': 'Middle East',
      'africa': 'Africa',
    };
    const regionLabel = regionLabels[delay.region] || escapeHtml(delay.region);

    const avgDelaySection = delay.avgDelayMinutes > 0
      ? `<div class="popup-stat"><span class="stat-label">AVG DELAY</span><span class="stat-value alert">+${delay.avgDelayMinutes} min</span></div>`
      : '';
    const reasonSection = delay.reason
      ? `<div class="popup-stat"><span class="stat-label">REASON</span><span class="stat-value">${escapeHtml(delay.reason)}</span></div>`
      : '';
    const cancelledSection = delay.cancelledFlights
      ? `<div class="popup-stat"><span class="stat-label">CANCELLED</span><span class="stat-value alert">${delay.cancelledFlights} flights</span></div>`
      : '';

    return `
      <div class="popup-header flight ${severityClass}">
        <span class="popup-icon">${icon}</span>
        <span class="popup-title">${escapeHtml(delay.iata)} - ${delayTypeLabel}</span>
        <span class="popup-badge ${severityClass}">${severityLabel}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(delay.name)}</div>
        <div class="popup-location">${escapeHtml(delay.city)}, ${escapeHtml(delay.country)}</div>
        <div class="popup-stats">
          ${avgDelaySection}
          ${reasonSection}
          ${cancelledSection}
          <div class="popup-stat">
            <span class="stat-label">REGION</span>
            <span class="stat-value">${regionLabel}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">SOURCE</span>
            <span class="stat-value">${sourceLabel}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">UPDATED</span>
            <span class="stat-value">${delay.updatedAt.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderAPTPopup(apt: APTGroup): string {
    return `
      <div class="popup-header apt">
        <span class="popup-title">${apt.name}</span>
        <span class="popup-badge high">THREAT</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">Also known as: ${apt.aka}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">SPONSOR</span>
            <span class="stat-value">${apt.sponsor}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">ORIGIN</span>
            <span class="stat-value">${apt.lat.toFixed(1)}°, ${apt.lon.toFixed(1)}°</span>
          </div>
        </div>
        <p class="popup-description">Advanced persistent exploit group with sophisticated capabilities. Known for targeting DeFi protocols, smart contracts, and cross-chain bridge infrastructure.</p>
      </div>
    `;
  }

  private renderCyberThreatPopup(threat: SecurityThreat): string {
    const severityClass = escapeHtml(threat.severity);
    const sourceLabels: Record<string, string> = {
      feodo: 'Feodo Tracker',
      urlhaus: 'URLhaus',
      c2intel: 'C2 Intel Feeds',
      otx: 'AlienVault OTX',
      abuseipdb: 'AbuseIPDB',
    };
    const sourceLabel = sourceLabels[threat.source] || threat.source;
    const typeLabel = threat.type.replace(/_/g, ' ').toUpperCase();
    const tags = (threat.tags || []).slice(0, 6);

    return `
      <div class="popup-header apt ${severityClass}">
        <span class="popup-title">Cyber Threat</span>
        <span class="popup-badge ${severityClass}">${escapeHtml(threat.severity.toUpperCase())}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(typeLabel)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">${escapeHtml(threat.indicatorType.toUpperCase())}</span>
            <span class="stat-value">${escapeHtml(threat.indicator)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COUNTRY</span>
            <span class="stat-value">${escapeHtml(threat.country || 'Unknown')}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">SOURCE</span>
            <span class="stat-value">${escapeHtml(sourceLabel)}</span>
          </div>
          ${threat.malwareFamily ? `<div class="popup-stat">
            <span class="stat-label">MALWARE</span>
            <span class="stat-value">${escapeHtml(threat.malwareFamily)}</span>
          </div>` : ''}
          <div class="popup-stat">
            <span class="stat-label">LAST SEEN</span>
            <span class="stat-value">${escapeHtml(threat.lastSeen ? new Date(threat.lastSeen).toLocaleString() : 'Unknown')}</span>
          </div>
        </div>
        ${tags.length > 0 ? `
        <div class="popup-tags">
          ${tags.map((tag) => `<span class="popup-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>` : ''}
      </div>
    `;
  }

  private renderNuclearPopup(facility: EnergyFacility): string {
    const typeLabels: Record<string, string> = {
      'plant': 'FLAGGED WALLET',
      'enrichment': 'MIXER',
      'weapons': 'SANCTIONED ENTITY',
      'research': 'UNDER REVIEW',
    };
    const statusColors: Record<string, string> = {
      'active': 'elevated',
      'contested': 'high',
      'decommissioned': 'low',
    };

    return `
      <div class="popup-header nuclear">
        <span class="popup-title">${facility.name.toUpperCase()}</span>
        <span class="popup-badge ${statusColors[facility.status] || 'low'}">${facility.status.toUpperCase()}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">${typeLabels[facility.type] || facility.type.toUpperCase()}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">STATUS</span>
            <span class="stat-value">${facility.status.toUpperCase()}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${facility.lat.toFixed(2)}°, ${facility.lon.toFixed(2)}°</span>
          </div>
        </div>
        <p class="popup-description">Flagged address under monitoring. Significant risk indicator for compliance and regulatory concerns.</p>
      </div>
    `;
  }

  private renderEconomicPopup(center: EconomicCenter): string {
    const typeLabels: Record<string, string> = {
      'exchange': 'STOCK EXCHANGE',
      'central-bank': 'CENTRAL BANK',
      'financial-hub': 'FINANCIAL HUB',
    };
    const typeIcons: Record<string, string> = {
      'exchange': '📈',
      'central-bank': '🏛',
      'financial-hub': '💰',
    };

    const marketStatus = center.marketHours ? this.getMarketStatus(center.marketHours) : null;

    return `
      <div class="popup-header economic ${center.type}">
        <span class="popup-title">${typeIcons[center.type] || ''} ${center.name.toUpperCase()}</span>
        <span class="popup-badge ${marketStatus === 'OPEN' ? 'elevated' : 'low'}">${marketStatus || typeLabels[center.type]}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        ${center.description ? `<p class="popup-description">${center.description}</p>` : ''}
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">${typeLabels[center.type] || center.type.toUpperCase()}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COUNTRY</span>
            <span class="stat-value">${center.country}</span>
          </div>
          ${center.marketHours ? `
          <div class="popup-stat">
            <span class="stat-label">TRADING HOURS</span>
            <span class="stat-value">${center.marketHours.open} - ${center.marketHours.close}</span>
          </div>
          ` : ''}
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${center.lat.toFixed(2)}°, ${center.lon.toFixed(2)}°</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderIrradiatorPopup(irradiator: GammaIrradiator): string {
    return `
      <div class="popup-header node">
        <span class="popup-title">⚠️ ${irradiator.city.toUpperCase()}</span>
        <span class="popup-badge elevated">GAMMA</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">MEV Bot Detection Node</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">COUNTRY</span>
            <span class="stat-value">${irradiator.country}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">CITY</span>
            <span class="stat-value">${irradiator.city}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${irradiator.lat.toFixed(2)}°, ${irradiator.lon.toFixed(2)}°</span>
          </div>
        </div>
        <p class="popup-description">Automated MEV extraction bot operating across multiple chains. Monitors mempool for sandwich attacks, arbitrage, and liquidation opportunities.</p>
      </div>
    `;
  }

  private renderPipelinePopup(pipeline: Pipeline): string {
    const typeLabels: Record<string, string> = {
      'oil': 'YIELD PIPELINE',
      'gas': 'STAKING PIPELINE',
      'products': 'REWARDS PIPELINE',
    };
    const typeColors: Record<string, string> = {
      'oil': 'high',
      'gas': 'elevated',
      'products': 'low',
    };
    const statusLabels: Record<string, string> = {
      'operating': 'OPERATING',
      'construction': 'UNDER CONSTRUCTION',
    };
    const typeIcon = pipeline.type === 'oil' ? '�' : pipeline.type === 'gas' ? '⚡' : '🔄';

    return `
      <div class="popup-header pipeline ${pipeline.type}">
        <span class="popup-title">${typeIcon} ${pipeline.name.toUpperCase()}</span>
        <span class="popup-badge ${typeColors[pipeline.type] || 'low'}">${pipeline.type.toUpperCase()}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${typeLabels[pipeline.type] || 'PIPELINE'}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">STATUS</span>
            <span class="stat-value">${statusLabels[pipeline.status] || pipeline.status.toUpperCase()}</span>
          </div>
          ${pipeline.capacity ? `
          <div class="popup-stat">
            <span class="stat-label">CAPACITY</span>
            <span class="stat-value">${pipeline.capacity}</span>
          </div>
          ` : ''}
          ${pipeline.length ? `
          <div class="popup-stat">
            <span class="stat-label">LENGTH</span>
            <span class="stat-value">${pipeline.length}</span>
          </div>
          ` : ''}
          ${pipeline.operator ? `
          <div class="popup-stat">
            <span class="stat-label">OPERATOR</span>
            <span class="stat-value">${pipeline.operator}</span>
          </div>
          ` : ''}
        </div>
        ${pipeline.countries && pipeline.countries.length > 0 ? `
          <div class="popup-section">
            <span class="section-label">COUNTRIES</span>
            <div class="popup-tags">
              ${pipeline.countries.map(c => `<span class="popup-tag">${c}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        <p class="popup-description">Major ${pipeline.type} yield pipeline. ${pipeline.status === 'operating' ? 'Currently operational and generating returns.' : 'Currently under development.'}</p>
      </div>
    `;
  }

  private renderCablePopup(cable: UnderseaCable): string {
    const advisory = this.getLatestCableAdvisory(cable.id);
    const repairShip = this.getPriorityRepairShip(cable.id);
    const statusLabel = advisory ? (advisory.severity === 'fault' ? 'FAULT' : 'DEGRADED') : 'ACTIVE';
    const statusBadge = advisory ? (advisory.severity === 'fault' ? 'high' : 'elevated') : 'low';
    const repairEta = repairShip?.eta || advisory?.repairEta;
    const cableName = escapeHtml(cable.name.toUpperCase());
    const safeStatusLabel = escapeHtml(statusLabel);
    const safeRepairEta = repairEta ? escapeHtml(repairEta) : '';
    const advisoryTitle = advisory ? escapeHtml(advisory.title) : '';
    const advisoryImpact = advisory ? escapeHtml(advisory.impact) : '';
    const advisoryDescription = advisory ? escapeHtml(advisory.description) : '';
    const repairShipName = repairShip ? escapeHtml(repairShip.name) : '';
    const repairShipNote = repairShip ? escapeHtml(repairShip.note || 'Bridge relay tracking indicates active deployment toward fault site.') : '';

    return `
      <div class="popup-header cable">
        <span class="popup-title">🌐 ${cableName}</span>
        <span class="popup-badge ${statusBadge}">${cable.major ? 'MAJOR' : 'CABLE'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">Cross-chain Bridge</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">BRIDGE PROTOCOL</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">WAYPOINTS</span>
            <span class="stat-value">${cable.points.length}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">STATUS</span>
            <span class="stat-value">${safeStatusLabel}</span>
          </div>
          ${repairEta ? `
          <div class="popup-stat">
            <span class="stat-label">REPAIR ETA</span>
            <span class="stat-value">${safeRepairEta}</span>
          </div>
          ` : ''}
        </div>
        ${advisory ? `
          <div class="popup-section">
            <span class="section-label">FAULT ADVISORY</span>
            <div class="popup-tags">
              <span class="popup-tag">${advisoryTitle}</span>
              <span class="popup-tag">${advisoryImpact}</span>
            </div>
            <p class="popup-description">${advisoryDescription}</p>
          </div>
        ` : ''}
        ${repairShip ? `
          <div class="popup-section">
            <span class="section-label">REPAIR DEPLOYMENT</span>
            <div class="popup-tags">
              <span class="popup-tag">${repairShipName}</span>
              <span class="popup-tag">${repairShip.status === 'on-station' ? 'On Station' : 'En Route'}</span>
            </div>
            <p class="popup-description">${repairShipNote}</p>
          </div>
        ` : ''}
        <p class="popup-description">Cross-chain bridge protocol enabling asset transfers between networks. These bridges form the backbone of multi-chain connectivity, facilitating cross-ecosystem liquidity flows.</p>
      </div>
    `;
  }

  private renderCableAdvisoryPopup(advisory: CableAdvisory): string {
    const cable = UNDERSEA_CABLES.find((item) => item.id === advisory.cableId);
    const timeAgo = this.getTimeAgo(advisory.reported);
    const statusLabel = advisory.severity === 'fault' ? 'FAULT' : 'DEGRADED';
    const cableName = escapeHtml(cable?.name.toUpperCase() || advisory.cableId.toUpperCase());
    const advisoryTitle = escapeHtml(advisory.title);
    const advisoryImpact = escapeHtml(advisory.impact);
    const advisoryEta = advisory.repairEta ? escapeHtml(advisory.repairEta) : '';
    const advisoryDescription = escapeHtml(advisory.description);

    return `
      <div class="popup-header cable">
        <span class="popup-title">🚨 ${cableName}</span>
        <span class="popup-badge ${advisory.severity === 'fault' ? 'high' : 'elevated'}">${statusLabel}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${advisoryTitle}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">REPORTED</span>
            <span class="stat-value">${timeAgo}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">IMPACT</span>
            <span class="stat-value">${advisoryImpact}</span>
          </div>
          ${advisory.repairEta ? `
          <div class="popup-stat">
            <span class="stat-label">ETA</span>
            <span class="stat-value">${advisoryEta}</span>
          </div>
          ` : ''}
        </div>
        <p class="popup-description">${advisoryDescription}</p>
      </div>
    `;
  }

  private renderRepairShipPopup(ship: RepairShip): string {
    const cable = UNDERSEA_CABLES.find((item) => item.id === ship.cableId);
    const shipName = escapeHtml(ship.name.toUpperCase());
    const cableLabel = escapeHtml(cable?.name || ship.cableId);
    const shipEta = escapeHtml(ship.eta);
    const shipOperator = ship.operator ? escapeHtml(ship.operator) : '';
    const shipNote = escapeHtml(ship.note || 'Bridge relay tracking indicates active deployment in support of cross-chain bridge restoration.');

    return `
      <div class="popup-header cable">
        <span class="popup-title">� ${shipName}</span>
        <span class="popup-badge elevated">REPAIR SHIP</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${cableLabel}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">STATUS</span>
            <span class="stat-value">${ship.status === 'on-station' ? 'ON STATION' : 'EN ROUTE'}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">ETA</span>
            <span class="stat-value">${shipEta}</span>
          </div>
          ${ship.operator ? `
          <div class="popup-stat">
            <span class="stat-label">OPERATOR</span>
            <span class="stat-value">${shipOperator}</span>
          </div>
          ` : ''}
        </div>
        <p class="popup-description">${shipNote}</p>
      </div>
    `;
  }

  private getLatestCableAdvisory(cableId: string): CableAdvisory | undefined {
    const advisories = this.cableAdvisories.filter((item) => item.cableId === cableId);
    return advisories.reduce<CableAdvisory | undefined>((latest, advisory) => {
      if (!latest) return advisory;
      return advisory.reported.getTime() > latest.reported.getTime() ? advisory : latest;
    }, undefined);
  }

  private getPriorityRepairShip(cableId: string): RepairShip | undefined {
    const ships = this.repairShips.filter((item) => item.cableId === cableId);
    if (ships.length === 0) return undefined;
    const onStation = ships.find((ship) => ship.status === 'on-station');
    return onStation || ships[0];
  }

  private renderOutagePopup(outage: InternetOutage): string {
    const severityColors: Record<string, string> = {
      'total': 'high',
      'major': 'elevated',
      'partial': 'low',
    };
    const severityLabels: Record<string, string> = {
      'total': 'TOTAL BLACKOUT',
      'major': 'MAJOR OUTAGE',
      'partial': 'PARTIAL DISRUPTION',
    };
    const timeAgo = this.getTimeAgo(outage.pubDate);
    const severityClass = escapeHtml(outage.severity);

    return `
      <div class="popup-header outage ${severityClass}">
        <span class="popup-title">📡 ${escapeHtml(outage.country.toUpperCase())}</span>
        <span class="popup-badge ${severityColors[outage.severity] || 'low'}">${severityLabels[outage.severity] || 'DISRUPTION'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(outage.title)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">SEVERITY</span>
            <span class="stat-value">${escapeHtml(outage.severity.toUpperCase())}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">REPORTED</span>
            <span class="stat-value">${timeAgo}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${outage.lat.toFixed(2)}°, ${outage.lon.toFixed(2)}°</span>
          </div>
        </div>
        ${outage.categories && outage.categories.length > 0 ? `
          <div class="popup-section">
            <span class="section-label">CATEGORIES</span>
            <div class="popup-tags">
              ${outage.categories.slice(0, 5).map(c => `<span class="popup-tag">${escapeHtml(c)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        <p class="popup-description">${escapeHtml(outage.description.slice(0, 250))}${outage.description.length > 250 ? '...' : ''}</p>
        <a href="${sanitizeUrl(outage.link)}" target="_blank" class="popup-link">Read full report →</a>
      </div>
    `;
  }

  private renderDatacenterPopup(dc: AIDataCenter): string {
    const statusColors: Record<string, string> = {
      'existing': 'normal',
      'planned': 'elevated',
      'decommissioned': 'low',
    };
    const statusLabels: Record<string, string> = {
      'existing': 'OPERATIONAL',
      'planned': 'PLANNED',
      'decommissioned': 'DECOMMISSIONED',
    };

    const formatNumber = (n: number) => {
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
      if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
      return n.toString();
    };

    return `
      <div class="popup-header datacenter ${dc.status}">
        <span class="popup-title">🖥️ ${dc.name}</span>
        <span class="popup-badge ${statusColors[dc.status] || 'normal'}">${statusLabels[dc.status] || 'UNKNOWN'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${dc.owner} • ${dc.country}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">GPU/CHIP COUNT</span>
            <span class="stat-value">${formatNumber(dc.chipCount)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">CHIP TYPE</span>
            <span class="stat-value">${dc.chipType || 'Unknown'}</span>
          </div>
          ${dc.powerMW ? `
          <div class="popup-stat">
            <span class="stat-label">POWER</span>
            <span class="stat-value">${dc.powerMW.toFixed(0)} MW</span>
          </div>
          ` : ''}
          ${dc.sector ? `
          <div class="popup-stat">
            <span class="stat-label">SECTOR</span>
            <span class="stat-value">${dc.sector}</span>
          </div>
          ` : ''}
        </div>
        ${dc.note ? `<p class="popup-description">${dc.note}</p>` : ''}
        <div class="popup-attribution">Data: Epoch AI GPU Clusters</div>
      </div>
    `;
  }

  private renderDatacenterClusterPopup(data: DatacenterClusterData): string {
    const totalCount = data.count ?? data.items.length;
    const totalChips = data.totalChips ?? data.items.reduce((sum, dc) => sum + dc.chipCount, 0);
    const totalPower = data.totalPowerMW ?? data.items.reduce((sum, dc) => sum + (dc.powerMW || 0), 0);
    const existingCount = data.existingCount ?? data.items.filter(dc => dc.status === 'existing').length;
    const plannedCount = data.plannedCount ?? data.items.filter(dc => dc.status === 'planned').length;

    const formatNumber = (n: number) => {
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
      if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
      return n.toString();
    };

    const dcListHtml = data.items.slice(0, 8).map(dc => `
      <div class="cluster-item">
        <span class="cluster-item-icon">${dc.status === 'planned' ? '🔨' : '🖥️'}</span>
        <div class="cluster-item-info">
          <span class="cluster-item-name">${escapeHtml(dc.name.slice(0, 40))}${dc.name.length > 40 ? '...' : ''}</span>
          <span class="cluster-item-detail">${escapeHtml(dc.owner)} • ${formatNumber(dc.chipCount)} chips</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="popup-header datacenter cluster">
        <span class="popup-title">🖥️ ${totalCount} Data Centers</span>
        <span class="popup-badge elevated">${escapeHtml(data.region)}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(data.country)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TOTAL CHIPS</span>
            <span class="stat-value">${formatNumber(totalChips)}</span>
          </div>
          ${totalPower > 0 ? `
          <div class="popup-stat">
            <span class="stat-label">TOTAL POWER</span>
            <span class="stat-value">${totalPower.toFixed(0)} MW</span>
          </div>
          ` : ''}
          <div class="popup-stat">
            <span class="stat-label">OPERATIONAL</span>
            <span class="stat-value">${existingCount}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">PLANNED</span>
            <span class="stat-value">${plannedCount}</span>
          </div>
        </div>
        <div class="cluster-list">
          ${dcListHtml}
        </div>
        ${totalCount > 8 ? `<p class="popup-more">+ ${Math.max(0, totalCount - 8)} more data centers</p>` : ''}
        ${data.sampled ? `<p class="popup-more">Showing a sampled list of ${data.items.length} sites.</p>` : ''}
        <div class="popup-attribution">Data: Epoch AI GPU Clusters</div>
      </div>
    `;
  }

  private renderStartupHubPopup(hub: StartupHub): string {
    const tierLabels: Record<string, string> = { 'mega': 'MEGA HUB', 'major': 'MAJOR HUB', 'emerging': 'EMERGING' };
    const tierIcons: Record<string, string> = { 'mega': '🦄', 'major': '🚀', 'emerging': '💡' };
    return `
      <div class="popup-header startup-hub ${hub.tier}">
        <span class="popup-title">${tierIcons[hub.tier] || '🚀'} ${escapeHtml(hub.name)}</span>
        <span class="popup-badge ${hub.tier}">${tierLabels[hub.tier] || 'HUB'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(hub.city)}, ${escapeHtml(hub.country)}</div>
        ${hub.unicorns ? `
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">UNICORNS</span>
            <span class="stat-value">${hub.unicorns}+</span>
          </div>
        </div>
        ` : ''}
        ${hub.description ? `<p class="popup-description">${escapeHtml(hub.description)}</p>` : ''}
      </div>
    `;
  }

  private renderCloudRegionPopup(region: CloudRegion): string {
    const providerNames: Record<string, string> = { 'aws': 'Amazon Web Services', 'gcp': 'Google Cloud Platform', 'azure': 'Microsoft Azure', 'cloudflare': 'Cloudflare' };
    const providerIcons: Record<string, string> = { 'aws': '🟠', 'gcp': '🔵', 'azure': '🟣', 'cloudflare': '🟡' };
    return `
      <div class="popup-header cloud-region ${region.provider}">
        <span class="popup-title">${providerIcons[region.provider] || '☁️'} ${escapeHtml(region.name)}</span>
        <span class="popup-badge ${region.provider}">${region.provider.toUpperCase()}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(region.city)}, ${escapeHtml(region.country)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">PROVIDER</span>
            <span class="stat-value">${providerNames[region.provider] || region.provider}</span>
          </div>
          ${region.zones ? `
          <div class="popup-stat">
            <span class="stat-label">AVAILABILITY ZONES</span>
            <span class="stat-value">${region.zones}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderTechHQPopup(hq: TechHQ): string {
    const typeLabels: Record<string, string> = { 'faang': 'BIG TECH', 'unicorn': 'UNICORN', 'public': 'PUBLIC' };
    const typeIcons: Record<string, string> = { 'faang': '🏛️', 'unicorn': '🦄', 'public': '🏢' };
    return `
      <div class="popup-header tech-hq ${hq.type}">
        <span class="popup-title">${typeIcons[hq.type] || '🏢'} ${escapeHtml(hq.company)}</span>
        <span class="popup-badge ${hq.type}">${typeLabels[hq.type] || 'TECH'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(hq.city)}, ${escapeHtml(hq.country)}</div>
        <div class="popup-stats">
          ${hq.marketCap ? `
          <div class="popup-stat">
            <span class="stat-label">MARKET CAP</span>
            <span class="stat-value">${escapeHtml(hq.marketCap)}</span>
          </div>
          ` : ''}
          ${hq.employees ? `
          <div class="popup-stat">
            <span class="stat-label">EMPLOYEES</span>
            <span class="stat-value">${hq.employees.toLocaleString()}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderAcceleratorPopup(acc: Accelerator): string {
    const typeLabels: Record<string, string> = { 'accelerator': 'ACCELERATOR', 'incubator': 'INCUBATOR', 'studio': 'STARTUP STUDIO' };
    const typeIcons: Record<string, string> = { 'accelerator': '🎯', 'incubator': '🔬', 'studio': '🎨' };
    return `
      <div class="popup-header accelerator ${acc.type}">
        <span class="popup-title">${typeIcons[acc.type] || '🎯'} ${escapeHtml(acc.name)}</span>
        <span class="popup-badge ${acc.type}">${typeLabels[acc.type] || 'ACCELERATOR'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(acc.city)}, ${escapeHtml(acc.country)}</div>
        <div class="popup-stats">
          ${acc.founded ? `
          <div class="popup-stat">
            <span class="stat-label">FOUNDED</span>
            <span class="stat-value">${acc.founded}</span>
          </div>
          ` : ''}
        </div>
        ${acc.notable && acc.notable.length > 0 ? `
        <div class="popup-notable">
          <span class="notable-label">NOTABLE ALUMNI</span>
          <span class="notable-list">${acc.notable.map(n => escapeHtml(n)).join(', ')}</span>
        </div>
        ` : ''}
      </div>
    `;
  }

  private renderTechEventPopup(event: TechEventPopupData): string {
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const endDateStr = endDate > startDate && endDate.toDateString() !== startDate.toDateString()
      ? ` - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';

    const urgencyClass = event.daysUntil <= 7 ? 'urgent' : event.daysUntil <= 30 ? 'soon' : '';
    const daysLabel = event.daysUntil === 0 ? 'TODAY' : event.daysUntil === 1 ? 'TOMORROW' : `IN ${event.daysUntil} DAYS`;

    return `
      <div class="popup-header tech-event ${urgencyClass}">
        <span class="popup-title">📅 ${escapeHtml(event.title)}</span>
        <span class="popup-badge ${urgencyClass}">${daysLabel}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">📍 ${escapeHtml(event.location)}, ${escapeHtml(event.country)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">DATE</span>
            <span class="stat-value">${dateStr}${endDateStr}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">LOCATION</span>
            <span class="stat-value">${escapeHtml(event.location)}</span>
          </div>
        </div>
        ${event.url ? `
        <a href="${sanitizeUrl(event.url)}" target="_blank" rel="noopener noreferrer" class="popup-link">
          More Information →
        </a>
        ` : ''}
      </div>
    `;
  }

  private renderTechHQClusterPopup(data: TechHQClusterData): string {
    const totalCount = data.count ?? data.items.length;
    const unicornCount = data.unicornCount ?? data.items.filter(h => h.type === 'unicorn').length;
    const faangCount = data.faangCount ?? data.items.filter(h => h.type === 'faang').length;
    const publicCount = data.publicCount ?? data.items.filter(h => h.type === 'public').length;

    const sortedItems = [...data.items].sort((a, b) => {
      const typeOrder = { faang: 0, unicorn: 1, public: 2 };
      return (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
    });

    const listItems = sortedItems.map(hq => {
      const icon = hq.type === 'faang' ? '🏛️' : hq.type === 'unicorn' ? '🦄' : '🏢';
      const marketCap = hq.marketCap ? ` (${hq.marketCap})` : '';
      return `<li class="cluster-item ${hq.type}">${icon} ${escapeHtml(hq.company)}${marketCap}</li>`;
    }).join('');

    return `
      <div class="popup-header tech-hq cluster">
        <span class="popup-title">🏙️ ${escapeHtml(data.city)}</span>
        <span class="popup-badge">${totalCount} COMPANIES</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body cluster-popup">
        <div class="popup-subtitle">📍 ${escapeHtml(data.city)}, ${escapeHtml(data.country)}</div>
        <div class="cluster-summary">
          ${faangCount ? `<span class="summary-item faang">🏛️ ${faangCount} Big Tech</span>` : ''}
          ${unicornCount ? `<span class="summary-item unicorn">🦄 ${unicornCount} Unicorns</span>` : ''}
          ${publicCount ? `<span class="summary-item public">🏢 ${publicCount} Public</span>` : ''}
        </div>
        <ul class="cluster-list">${listItems}</ul>
        ${data.sampled ? `<p class="popup-more">Showing a sampled list of ${data.items.length} companies.</p>` : ''}
      </div>
    `;
  }

  private renderTechEventClusterPopup(data: TechEventClusterData): string {
    const totalCount = data.count ?? data.items.length;
    const upcomingSoon = data.soonCount ?? data.items.filter(e => e.daysUntil <= 14).length;
    const sortedItems = [...data.items].sort((a, b) => a.daysUntil - b.daysUntil);

    const listItems = sortedItems.map(event => {
      const startDate = new Date(event.startDate);
      const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const urgencyClass = event.daysUntil <= 7 ? 'urgent' : event.daysUntil <= 30 ? 'soon' : '';
      return `<li class="cluster-item ${urgencyClass}">📅 ${dateStr}: ${escapeHtml(event.title)}</li>`;
    }).join('');

    return `
      <div class="popup-header tech-event cluster">
        <span class="popup-title">📅 ${escapeHtml(data.location)}</span>
        <span class="popup-badge">${totalCount} EVENTS</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body cluster-popup">
        <div class="popup-subtitle">📍 ${escapeHtml(data.location)}, ${escapeHtml(data.country)}</div>
        ${upcomingSoon ? `<div class="cluster-summary"><span class="summary-item soon">⚡ ${upcomingSoon} upcoming within 2 weeks</span></div>` : ''}
        <ul class="cluster-list">${listItems}</ul>
        ${data.sampled ? `<p class="popup-more">Showing a sampled list of ${data.items.length} events.</p>` : ''}
      </div>
    `;
  }

  private renderBridgeFlowPopup(flow: BridgeFlow): string {
    const fmtVol = flow.volume24h >= 1e6
      ? `$${(flow.volume24h / 1e6).toFixed(2)}M`
      : `$${(flow.volume24h / 1e3).toFixed(0)}K`;
    const fmtTx = flow.txCount >= 1000
      ? `${(flow.txCount / 1000).toFixed(1)}K`
      : String(flow.txCount);

    return `
      <div class="popup-header defi">
        <span class="popup-title">🌉 Cross-Chain Flow</span>
        <span class="popup-badge">${fmtVol}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">SOURCE</span>
            <span class="stat-value">${escapeHtml(flow.sourceChain)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">DESTINATION</span>
            <span class="stat-value">${escapeHtml(flow.targetChain)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">BRIDGE</span>
            <span class="stat-value">${escapeHtml(flow.bridgeName)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">24H VOLUME</span>
            <span class="stat-value">${fmtVol}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">TRANSACTIONS</span>
            <span class="stat-value">${fmtTx}</span>
          </div>
        </div>
      </div>
    `;
  }

  private getMarketStatus(hours: { open: string; close: string; timezone: string }): string {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: hours.timezone,
      });
      const currentTime = formatter.format(now);
      const [openH = 0, openM = 0] = hours.open.split(':').map(Number);
      const [closeH = 0, closeM = 0] = hours.close.split(':').map(Number);
      const [currH = 0, currM = 0] = currentTime.split(':').map(Number);

      const openMins = openH * 60 + openM;
      const closeMins = closeH * 60 + closeM;
      const currMins = currH * 60 + currM;

      if (currMins >= openMins && currMins < closeMins) {
        return 'OPEN';
      }
      return 'CLOSED';
    } catch {
      return 'UNKNOWN';
    }
  }

  private renderMilitaryFlightPopup(flight: TrackedFlight): string {
    const operatorLabels: Record<string, string> = {
      usaf: 'Titan Vault',
      usn: 'Neptune Fund',
      usmc: 'Spartan DAO',
      usa: 'Sentinel Fund',
      raf: 'Crown Protocol',
      rn: 'Trident Fund',
      faf: 'Tricolor DAO',
      gaf: 'Iron Gate Fund',
      plaaf: 'Jade Protocol',
      plan: 'Dragon Fund',
      vks: 'Arctic Vault',
      iaf: 'Lotus Fund',
      nato: 'Multi-sig Alliance',
      other: 'Unknown',
    };
    const typeLabels: Record<string, string> = {
      fighter: 'Swap',
      bomber: 'Large Transfer',
      transport: 'Bridge Transfer',
      tanker: 'Liquidity Add',
      awacs: 'Oracle Update',
      reconnaissance: 'Scan',
      helicopter: 'Flash Loan',
      drone: 'Bot TX',
      patrol: 'Monitoring',
      special_ops: 'MEV Bundle',
      vip: 'Governance TX',
      unknown: 'Unknown',
    };
    const confidenceColors: Record<string, string> = {
      high: 'elevated',
      medium: 'low',
      low: 'low',
    };
    const callsign = escapeHtml(flight.callsign || 'Unknown');
    const aircraftTypeBadge = escapeHtml(flight.aircraftType.toUpperCase());
    const operatorLabel = escapeHtml(operatorLabels[flight.operator] || flight.operatorCountry || 'Unknown');
    const hexCode = escapeHtml(flight.hexCode || '');
    const aircraftType = escapeHtml(typeLabels[flight.aircraftType] || flight.aircraftType);
    const squawk = flight.squawk ? escapeHtml(flight.squawk) : '';
    const note = flight.note ? escapeHtml(flight.note) : '';

    return `
      <div class="popup-header tracker ${flight.operator}">
        <span class="popup-title">${callsign}</span>
        <span class="popup-badge ${confidenceColors[flight.confidence] || 'low'}">${aircraftTypeBadge}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${operatorLabel}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TIER</span>
            <span class="stat-value">${flight.altitude > 0 ? `T${Math.round(flight.altitude / 100)}` : 'Base'}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">VELOCITY</span>
            <span class="stat-value">${flight.speed}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">DIRECTION</span>
            <span class="stat-value">${Math.round(flight.heading)}°</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">TX HASH</span>
            <span class="stat-value">${hexCode}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">${aircraftType}</span>
          </div>
          ${flight.squawk ? `
          <div class="popup-stat">
            <span class="stat-label">SIGNAL</span>
            <span class="stat-value">${squawk}</span>
          </div>
          ` : ''}
        </div>
        ${flight.note ? `<p class="popup-description">${note}</p>` : ''}
        <div class="popup-attribution">On-chain data</div>
      </div>
    `;
  }

  private renderMilitaryVesselPopup(vessel: TrackedVessel): string {
    const operatorLabels: Record<string, string> = {
      usn: 'Titan Protocol',
      uscg: 'Sentinel Protocol',
      rn: 'Crown Protocol',
      fn: 'Tricolor Protocol',
      plan: 'Dragon Protocol',
      ruf: 'Arctic Protocol',
      jmsdf: 'Sakura Protocol',
      rokn: 'Horizon Protocol',
      other: 'Unknown',
    };
    const typeLabels: Record<string, string> = {
      carrier: 'Vault',
      destroyer: 'Liquidator',
      frigate: 'Aggregator',
      submarine: 'Dark Pool',
      amphibious: 'Multi-chain',
      patrol: 'Monitor',
      auxiliary: 'Relay',
      research: 'Analytics',
      icebreaker: 'Pioneer',
      special: 'Custom',
      unknown: 'Unknown',
    };

    const darkWarning = vessel.isDark
      ? '<span class="popup-badge high">AIS DARK</span>'
      : '';

    // Show AIS ship type when military type is unknown
    const displayType = vessel.vesselType === 'unknown' && vessel.aisShipType
      ? vessel.aisShipType
      : (typeLabels[vessel.vesselType] || vessel.vesselType);
    const badgeType = vessel.vesselType === 'unknown' && vessel.aisShipType
      ? vessel.aisShipType.toUpperCase()
      : vessel.vesselType.toUpperCase();
    const vesselName = escapeHtml(vessel.name || `Vessel ${vessel.mmsi}`);
    const vesselOperator = escapeHtml(operatorLabels[vessel.operator] || vessel.operatorCountry || 'Unknown');
    const vesselTypeLabel = escapeHtml(displayType);
    const vesselBadgeType = escapeHtml(badgeType);
    const vesselMmsi = escapeHtml(vessel.mmsi);
    const vesselHull = vessel.hullNumber ? escapeHtml(vessel.hullNumber) : '';
    const vesselNote = vessel.note ? escapeHtml(vessel.note) : '';

    return `
      <div class="popup-header route ${vessel.operator}">
        <span class="popup-title">${vesselName}</span>
        ${darkWarning}
        <span class="popup-badge elevated">${vesselBadgeType}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${vesselOperator}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">${vesselTypeLabel}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">VELOCITY</span>
            <span class="stat-value">${vessel.speed}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">DIRECTION</span>
            <span class="stat-value">${Math.round(vessel.heading)}°</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">PROTOCOL ID</span>
            <span class="stat-value">${vesselMmsi}</span>
          </div>
          ${vessel.hullNumber ? `
          <div class="popup-stat">
            <span class="stat-label">NODE ID</span>
            <span class="stat-value">${vesselHull}</span>
          </div>
          ` : ''}
        </div>
        ${vessel.note ? `<p class="popup-description">${vesselNote}</p>` : ''}
        ${vessel.isDark ? '<p class="popup-description alert">⚠ Protocol has gone dark - on-chain signal lost. May indicate privacy mode activation.</p>' : ''}
      </div>
    `;
  }

  private renderMilitaryFlightClusterPopup(cluster: FlightCluster): string {
    const activityLabels: Record<string, string> = {
      exercise: 'Accumulation Event',
      patrol: 'Monitoring Activity',
      transport: 'Transfer Operations',
      unknown: 'Whale Activity',
    };
    const activityColors: Record<string, string> = {
      exercise: 'high',
      patrol: 'elevated',
      transport: 'low',
      unknown: 'low',
    };

    const activityType = cluster.activityType || 'unknown';
    const clusterName = escapeHtml(cluster.name);
    const activityTypeLabel = escapeHtml(activityType.toUpperCase());
    const dominantOperator = cluster.dominantOperator ? escapeHtml(cluster.dominantOperator.toUpperCase()) : '';
    const flightSummary = cluster.flights
      .slice(0, 5)
      .map(f => `<div class="cluster-flight-item">${escapeHtml(f.callsign)} - ${escapeHtml(f.aircraftType)}</div>`)
      .join('');
    const moreFlights = cluster.flightCount > 5
      ? `<div class="cluster-more">+${cluster.flightCount - 5} more transactions</div>`
      : '';

    return `
      <div class="popup-header tracker-cluster">
        <span class="popup-title">${clusterName}</span>
        <span class="popup-badge ${activityColors[activityType] || 'low'}">${cluster.flightCount} TXS</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${activityLabels[activityType] || 'Whale Activity'}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">TXS</span>
            <span class="stat-value">${cluster.flightCount}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">ACTIVITY</span>
            <span class="stat-value">${activityTypeLabel}</span>
          </div>
          ${cluster.dominantOperator ? `
          <div class="popup-stat">
            <span class="stat-label">PRIMARY</span>
            <span class="stat-value">${dominantOperator}</span>
          </div>
          ` : ''}
        </div>
        <div class="popup-section">
          <span class="section-label">TRACKED TRANSACTIONS</span>
          <div class="cluster-flights">
            ${flightSummary}
            ${moreFlights}
          </div>
        </div>
      </div>
    `;
  }

  private renderMilitaryVesselClusterPopup(cluster: VesselCluster): string {
    const activityLabels: Record<string, string> = {
      exercise: 'Protocol Stress Test',
      deployment: 'Protocol Deployment',
      patrol: 'Monitoring Activity',
      transit: 'Liquidity Migration',
      unknown: 'Protocol Activity',
    };
    const activityColors: Record<string, string> = {
      exercise: 'high',
      deployment: 'high',
      patrol: 'elevated',
      transit: 'low',
      unknown: 'low',
    };

    const activityType = cluster.activityType || 'unknown';
    const clusterName = escapeHtml(cluster.name);
    const activityTypeLabel = escapeHtml(activityType.toUpperCase());
    const region = cluster.region ? escapeHtml(cluster.region) : '';
    const vesselSummary = cluster.vessels
      .slice(0, 5)
      .map(v => `<div class="cluster-vessel-item">${escapeHtml(v.name)} - ${escapeHtml(v.vesselType)}</div>`)
      .join('');
    const moreVessels = cluster.vesselCount > 5
      ? `<div class="cluster-more">+${cluster.vesselCount - 5} more protocols</div>`
      : '';

    return `
      <div class="popup-header route-cluster">
        <span class="popup-title">${clusterName}</span>
        <span class="popup-badge ${activityColors[activityType] || 'low'}">${cluster.vesselCount} PROTOCOLS</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${activityLabels[activityType] || 'Protocol Activity'}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">PROTOCOLS</span>
            <span class="stat-value">${cluster.vesselCount}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">ACTIVITY</span>
            <span class="stat-value">${activityTypeLabel}</span>
          </div>
          ${cluster.region ? `
          <div class="popup-stat">
            <span class="stat-label">REGION</span>
            <span class="stat-value">${region}</span>
          </div>
          ` : ''}
        </div>
        <div class="popup-section">
          <span class="section-label">TRACKED PROTOCOLS</span>
          <div class="cluster-vessels">
            ${vesselSummary}
            ${moreVessels}
          </div>
        </div>
      </div>
    `;
  }

  private renderNaturalEventPopup(event: NaturalEvent): string {
    const categoryColors: Record<string, string> = {
      severeStorms: 'high',
      wildfires: 'high',
      volcanoes: 'high',
      earthquakes: 'elevated',
      floods: 'elevated',
      landslides: 'elevated',
      drought: 'medium',
      dustHaze: 'low',
      snow: 'low',
      tempExtremes: 'elevated',
      seaLakeIce: 'low',
      waterColor: 'low',
      manmade: 'elevated',
    };
    const icon = getNaturalEventIcon(event.category);
    const severityClass = categoryColors[event.category] || 'low';
    const timeAgo = this.getTimeAgo(event.date);

    return `
      <div class="popup-header nat-event ${event.category}">
        <span class="popup-icon">${icon}</span>
        <span class="popup-title">${escapeHtml(event.categoryTitle.toUpperCase())}</span>
        <span class="popup-badge ${severityClass}">${event.closed ? 'CLOSED' : 'ACTIVE'}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(event.title)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">REPORTED</span>
            <span class="stat-value">${timeAgo}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${event.lat.toFixed(2)}°, ${event.lon.toFixed(2)}°</span>
          </div>
          ${event.magnitude ? `
          <div class="popup-stat">
            <span class="stat-label">MAGNITUDE</span>
            <span class="stat-value">${event.magnitude}${event.magnitudeUnit ? ` ${escapeHtml(event.magnitudeUnit)}` : ''}</span>
          </div>
          ` : ''}
          ${event.sourceName ? `
          <div class="popup-stat">
            <span class="stat-label">SOURCE</span>
            <span class="stat-value">${escapeHtml(event.sourceName)}</span>
          </div>
          ` : ''}
        </div>
        ${event.description ? `<p class="popup-description">${escapeHtml(event.description)}</p>` : ''}
        ${event.sourceUrl ? `<a href="${sanitizeUrl(event.sourceUrl)}" target="_blank" class="popup-link">View on ${escapeHtml(event.sourceName || 'source')} →</a>` : ''}
        <div class="popup-attribution">Data: NASA EONET</div>
      </div>
    `;
  }

  private renderPortPopup(port: Port): string {
    const typeLabels: Record<string, string> = {
      container: 'CONTAINER',
      oil: 'OIL TERMINAL',
      lng: 'LNG TERMINAL',
      naval: 'DEX HUB',
      mixed: 'MIXED',
      bulk: 'BULK',
    };
    const typeColors: Record<string, string> = {
      container: 'elevated',
      oil: 'high',
      lng: 'high',
      naval: 'elevated',
      mixed: 'normal',
      bulk: 'low',
    };
    const typeIcons: Record<string, string> = {
      container: '�',
      oil: '💧',
      lng: '⚡',
      naval: '🔗',
      mixed: '🔀',
      bulk: '📦',
    };

    const rankSection = port.rank
      ? `<div class="popup-stat"><span class="stat-label">WORLD RANK</span><span class="stat-value">#${port.rank}</span></div>`
      : '';

    return `
      <div class="popup-header port ${escapeHtml(port.type)}">
        <span class="popup-icon">${typeIcons[port.type] || '�'}</span>
        <span class="popup-title">${escapeHtml(port.name.toUpperCase())}</span>
        <span class="popup-badge ${typeColors[port.type] || 'normal'}">${typeLabels[port.type] || port.type.toUpperCase()}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(port.country)}</div>
        <div class="popup-stats">
          ${rankSection}
          <div class="popup-stat">
            <span class="stat-label">TYPE</span>
            <span class="stat-value">${typeLabels[port.type] || port.type.toUpperCase()}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${port.lat.toFixed(2)}°, ${port.lon.toFixed(2)}°</span>
          </div>
        </div>
        <p class="popup-description">${escapeHtml(port.note)}</p>
      </div>
    `;
  }

  private renderSpaceportPopup(port: Spaceport): string {
    const statusColors: Record<string, string> = {
      'active': 'elevated',
      'construction': 'high',
      'inactive': 'low',
    };
    const statusLabels: Record<string, string> = {
      'active': 'ACTIVE',
      'construction': 'CONSTRUCTION',
      'inactive': 'INACTIVE',
    };

    return `
      <div class="popup-header spaceport ${port.status}">
        <span class="popup-icon">🚀</span>
        <span class="popup-title">${escapeHtml(port.name.toUpperCase())}</span>
        <span class="popup-badge ${statusColors[port.status] || 'normal'}">${statusLabels[port.status] || port.status.toUpperCase()}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(port.operator)} • ${escapeHtml(port.country)}</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">LAUNCH ACTIVITY</span>
            <span class="stat-value">${escapeHtml(port.launches.toUpperCase())}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${port.lat.toFixed(2)}°, ${port.lon.toFixed(2)}°</span>
          </div>
        </div>
        <p class="popup-description">Token launch platform. Launch frequency and network reach are key DeFi ecosystem indicators.</p>
      </div>
    `;
  }

  private buildDetailPayload(data: PopupData): { type: string; data: unknown } | null {
    switch (data.type) {
      case 'risk': {
        const d = data.data as RiskRegion;
        return { type: 'event', data: {
          title: d.name, category: 'conflict',
          description: d.description,
          lat: d.center?.[1], lon: d.center?.[0],
          affected: d.displaced, deaths: d.casualties ? parseInt(d.casualties) : undefined,
          country: d.location,
        }};
      }
      case 'earthquake': {
        const d = data.data as Earthquake;
        return { type: 'event', data: {
          title: `M${d.magnitude} ${d.place}`,
          category: 'earthquake',
          magnitude: d.magnitude,
          depth: d.depth,
          date: d.time ? new Date(d.time).toISOString() : undefined,
          lat: d.lat,
          lon: d.lon,
          url: d.url,
          source: 'USGS',
        }};
      }
      case 'trend': {
        const d = data.data as Hotspot;
        return { type: 'event', data: {
          title: d.name,
          category: 'conflict',
          description: d.description,
          severity: d.level,
          lat: d.lat, lon: d.lon,
          country: d.location,
        }};
      }
      case 'weather': {
        const d = data.data as WeatherAlert;
        return { type: 'event', data: {
          title: d.event,
          category: 'weather',
          description: d.description,
          severity: d.severity,
        }};
      }
      case 'base': {
        const d = data.data as TrackedFacility;
        return { type: 'event', data: {
          title: d.name,
          category: 'military',
          description: d.description || `${d.type || 'Military facility'}`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'waterway': {
        const d = data.data as KeyWaterway;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: d.description || 'Key waterway',
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'apt': {
        const d = data.data as APTGroup;
        return { type: 'event', data: {
          title: d.name,
          category: 'cyber',
          description: `Sponsor: ${d.sponsor} | AKA: ${d.aka}`,
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'cyberThreat': {
        const d = data.data as SecurityThreat;
        return { type: 'event', data: {
          title: `Cyber Threat - ${d.type.replace(/_/g, ' ')}`,
          category: 'cyber',
          description: `Indicator: ${d.indicator} | Malware: ${d.malwareFamily || 'Unknown'}`,
          severity: d.severity,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'nuclear': {
        const d = data.data as EnergyFacility;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: `Type: ${d.type} | Status: ${d.status}`,
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'economic': {
        const d = data.data as EconomicCenter;
        return { type: 'event', data: {
          title: d.name,
          category: 'economic',
          description: d.description || `${d.type} in ${d.country}`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'irradiator': {
        const d = data.data as GammaIrradiator;
        return { type: 'event', data: {
          title: `Gamma Irradiator - ${d.city}`,
          category: 'infrastructure',
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'pipeline': {
        const d = data.data as Pipeline;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: `${d.type} pipeline - ${d.status}`,
        }};
      }
      case 'cable': {
        const d = data.data as UnderseaCable;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: d.owners ? `Owners: ${d.owners.join(', ')}` : 'Undersea cable',
        }};
      }
      case 'cable-advisory': {
        const d = data.data as CableAdvisory;
        return { type: 'event', data: {
          title: d.title,
          category: 'infrastructure',
          description: d.description,
          severity: d.severity,
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'repair-ship': {
        const d = data.data as RepairShip;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: `Status: ${d.status} | ETA: ${d.eta}`,
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'outage': {
        const d = data.data as InternetOutage;
        return { type: 'event', data: {
          title: `Internet Outage - ${d.country}`,
          category: 'outage',
          description: d.description,
          severity: d.severity,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'datacenter': {
        const d = data.data as AIDataCenter;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: `Owner: ${d.owner} | Chips: ${d.chipCount}`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'ais': {
        const d = data.data as AisDisruptionEvent;
        return { type: 'event', data: {
          title: d.name,
          category: 'maritime',
          description: d.description,
          severity: d.severity,
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'event': {
        const d = data.data as SocialUnrestEvent;
        return { type: 'event', data: {
          title: d.title || `${d.eventType} in ${d.country}`,
          category: 'social',
          lat: d.lat, lon: d.lon,
          country: d.country,
          date: d.time ? new Date(d.time).toISOString() : undefined,
          source: d.sourceType,
        }};
      }
      case 'flight': {
        const d = data.data as AirportDelayAlert;
        return { type: 'event', data: {
          title: `${d.iata} - ${d.name}`,
          category: 'flight',
          description: `Delay: ${d.avgDelayMinutes}min | Reason: ${d.reason || 'Unknown'}`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'militaryFlight': {
        const d = data.data as TrackedFlight;
        return { type: 'event', data: {
          title: `${d.callsign || 'Unknown'} - Military Flight`,
          category: 'military',
          description: `Aircraft: ${d.aircraftType} | Altitude: ${d.altitude} ft | Speed: ${d.speed} kts`,
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'militaryVessel': {
        const d = data.data as TrackedVessel;
        return { type: 'event', data: {
          title: `${d.name || d.mmsi} - Naval Vessel`,
          category: 'military',
          description: `Type: ${d.vesselType} | Operator: ${d.operatorCountry || 'Unknown'}`,
          lat: d.lat, lon: d.lon,
        }};
      }
      case 'natEvent': {
        const d = data.data as NaturalEvent;
        return { type: 'event', data: {
          title: d.title,
          category: d.category,
          description: d.description,
          lat: d.lat, lon: d.lon,
          source: d.sourceName,
          url: d.sourceUrl,
        }};
      }
      case 'port': {
        const d = data.data as Port;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: d.note,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'spaceport': {
        const d = data.data as Spaceport;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: `Operator: ${d.operator} | Status: ${d.status}`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'mineral': {
        const d = data.data as CriticalMineralProject;
        return { type: 'event', data: {
          title: d.name,
          category: 'infrastructure',
          description: `${d.mineral} - ${d.operator} | ${d.significance}`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      // Cluster types - build a summary event
      case 'protestCluster':
      case 'datacenterCluster':
      case 'militaryFlightCluster':
      case 'militaryVesselCluster':
      case 'techHQCluster':
      case 'techEventCluster': {
        const label = data.type.replace('Cluster', '');
        return { type: 'event', data: {
          title: `${label.charAt(0).toUpperCase()}${label.slice(1)} Cluster`,
          category: 'cluster',
          description: `Cluster of ${label} items`,
        }};
      }
      // Tech variant popups
      case 'startupHub': {
        const d = data.data as StartupHub;
        return { type: 'event', data: {
          title: d.name,
          category: 'tech',
          description: d.description || '',
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'cloudRegion': {
        const d = data.data as CloudRegion;
        return { type: 'event', data: {
          title: d.name,
          category: 'tech',
          description: `${d.provider} cloud region`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'techHQ': {
        const d = data.data as TechHQ;
        return { type: 'event', data: {
          title: d.company,
          category: 'tech',
          description: `${d.type} company`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'accelerator': {
        const d = data.data as Accelerator;
        return { type: 'event', data: {
          title: d.name,
          category: 'tech',
          description: `${d.type}`,
          lat: d.lat, lon: d.lon,
          country: d.country,
        }};
      }
      case 'techEvent': {
        const d = data.data as TechEventPopupData;
        return { type: 'event', data: {
          title: d.title,
          category: 'tech',
          description: `${d.location}, ${d.country}`,
          lat: d.lat, lon: d.lng,
          country: d.country,
          url: d.url,
        }};
      }
      default:
        return null;
    }
  }

  private renderMineralPopup(mine: CriticalMineralProject): string {
    const statusColors: Record<string, string> = {
      'producing': 'elevated',
      'development': 'high',
      'exploration': 'low',
    };
    const statusLabels: Record<string, string> = {
      'producing': 'PRODUCING',
      'development': 'DEVELOPMENT',
      'exploration': 'EXPLORATION',
    };
    
    // Icon based on mineral type
    const icon = mine.mineral === 'Lithium' ? '🔋' : mine.mineral === 'Rare Earths' ? '🧲' : '💎';

    return `
      <div class="popup-header mineral ${mine.status}">
        <span class="popup-icon">${icon}</span>
        <span class="popup-title">${escapeHtml(mine.name.toUpperCase())}</span>
        <span class="popup-badge ${statusColors[mine.status] || 'normal'}">${statusLabels[mine.status] || mine.status.toUpperCase()}</span>
        <button class="popup-close">×</button>
      </div>
      <div class="popup-body">
        <div class="popup-subtitle">${escapeHtml(mine.mineral.toUpperCase())} PROJECT</div>
        <div class="popup-stats">
          <div class="popup-stat">
            <span class="stat-label">OPERATOR</span>
            <span class="stat-value">${escapeHtml(mine.operator)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COUNTRY</span>
            <span class="stat-value">${escapeHtml(mine.country)}</span>
          </div>
          <div class="popup-stat">
            <span class="stat-label">COORDINATES</span>
            <span class="stat-value">${mine.lat.toFixed(2)}°, ${mine.lon.toFixed(2)}°</span>
          </div>
        </div>
        <p class="popup-description">${escapeHtml(mine.significance)}</p>
      </div>
    `;
  }
}
