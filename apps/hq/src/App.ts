import type { NewsItem, Monitor, PanelConfig, MapLayers, RelatedAsset, InternetOutage, SocialUnrestEvent, TrackedFlight, TrackedVessel, FlightCluster, VesselCluster, SecurityThreat } from '@/types';
import {
  FEEDS,
  RESEARCH_SOURCES,
  SECTORS,
  COMMODITIES,
  MARKET_SYMBOLS,
  REFRESH_INTERVALS,
  DEFAULT_PANELS,
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
  STORAGE_KEYS,
  SITE_VARIANT,
} from '@/config';
import { BUILTIN_TEMPLATES, type DashboardTemplate } from '@/config/panels';
import { fetchCategoryFeeds, fetchMultipleStocks, fetchCrypto, fetchPredictions, fetchEarthquakes, fetchWeatherAlerts, fetchInternetOutages, isOutagesConfigured, fetchAisSignals, initAisStream, getAisStatus, disconnectAisStream, isAisConfigured, fetchCableActivity, fetchProtestEvents, getProtestStatus, fetchFlightDelays, fetchTrackedFlights, fetchTrackedVessels, initVesselStream, isVesselTrackingConfigured, initDB, updateBaseline, calculateDeviation, addToSignalHistory, saveSnapshot, cleanOldSnapshots, analysisWorker, fetchNaturalEvents, fetchCyberThreats, drainTrendingSignals } from '@/services';
import { fetchCountryMarkets } from '@/services/polymarket';
import { mlWorker } from '@/services/ml-worker';
import { clusterNewsHybrid } from '@/services/clustering';
import { startPriceFeed } from '@/services/websocket-prices';
import { ingestProtests, ingestFlights, ingestVessels, ingestEarthquakes, detectGeoConvergence, geoConvergenceToSignal } from '@/services/geo-convergence';
import { signalAggregator } from '@/services/signal-aggregator';
import { updateAndCheck } from '@/services/temporal-baseline';
import { fetchAllFires, flattenFires, computeRegionStats } from '@/services/firms-satellite';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { analyzeFlightsForSurge, surgeAlertToSignal, detectForeignPresence, foreignPresenceToSignal, type TheaterPostureSummary } from '@/services/military-surge';
import { fetchCachedTheaterPosture } from '@/services/cached-theater-posture';
import { ingestProtests as ingestProtestsForRisk, ingestActivityData, ingestNews as ingestNewsForRisk, ingestOutages as ingestOutagesForRisk, ingestConflicts as ingestConflictsForRisk, ingestUcdp as ingestUcdpForRisk, ingestHapi as ingestHapiForRisk, ingestDisplacement as ingestDisplacementForRisk, ingestClimate as ingestClimateForRisk, startLearning, isInLearningMode, calculateRiskScores, getCountryData, TIER1_COUNTRIES } from '@/services/country-instability';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import { fetchConflictEvents } from '@/services/conflicts';
import { fetchUcdpClassifications } from '@/services/ucdp';
import { fetchHapiSummary } from '@/services/hapi';
import { fetchUcdpEvents, deduplicateAgainstAcled } from '@/services/ucdp-events';
import { fetchUnhcrPopulation } from '@/services/unhcr';
import { fetchClimateAnomalies } from '@/services/climate';
import { enrichEventsWithExposure } from '@/services/population-exposure';
import { buildMapUrl, debounce, loadFromStorage, parseMapUrlState, saveToStorage, ExportPanel, isMobileDevice } from '@/utils';
import { reverseGeocode } from '@/utils/reverse-geocode';
import { CountryBriefPage } from '@/components/CountryBriefPage';
import { DetailPanel } from '@/components/DetailPanel';
import type { DetailOpenEvent } from '@/types';
import { CountryTimeline, type TimelineEvent } from '@/components/CountryTimeline';
import { escapeHtml } from '@/utils/sanitize';
import type { ParsedMapUrlState } from '@/utils';
import {
  MapContainer,
  type MapView,
  NewsPanel,
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  Panel,
  PlaybackControl,
  StatusPanel,
  SearchModal,
  GdeltIntelPanel,
  LiveNewsPanel,
  CIIPanel,
  CascadePanel,
  StrategicRiskPanel,
  StrategicPosturePanel,
  RuntimeConfigPanel,
  InsightsPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  TradingViewChart,
  TradingViewWidgetPanel,
  NotificationCenter,
} from '@/components';
import type { TechReadinessPanel } from '@/components/TechReadinessPanel';
import type { SearchResult } from '@/components/SearchModal';
import { collectStoryData } from '@/services/story-data';
import { renderStoryToCanvas } from '@/services/story-renderer';
import { openStoryModal } from '@/components/StoryModal';
import { FOCUS_AREAS, RISK_REGIONS, TRACKED_FACILITIES, UNDERSEA_CABLES, ENERGY_FACILITIES } from '@/config/geo';
import { PIPELINES } from '@/config/pipelines';
import { AI_DATA_CENTERS } from '@/config/ai-datacenters';
import { GAMMA_IRRADIATORS } from '@/config/irradiators';
import { TECH_COMPANIES } from '@/config/tech-companies';
import { AI_RESEARCH_LABS } from '@/config/ai-research-labs';
import { STARTUP_ECOSYSTEMS } from '@/config/startup-ecosystems';
import { TECH_HQS, ACCELERATORS } from '@/config/tech-geo';
import { isDesktopRuntime } from '@/services/runtime';
import { getCountryAtCoordinates, hasCountryGeometry, isCoordinateInCountry, preloadCountryGeometry } from '@/services/country-geometry';
import { hqBridge } from '@/services/hq-bridge';
import type { HQCommandType, ApplyTemplatePayload, TogglePanelPayload, FlyToCountryPayload, ShowPanelPayload } from '@/services/hq-bridge';

import type { PredictionMarket, MarketData, ClusteredEvent } from '@/types';

type IntlDisplayNamesCtor = new (
  locales: string | string[],
  options: { type: 'region' }
) => { of: (code: string) => string | undefined };

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export interface CountryBriefSignals {
  protests: number;
  trackedFlights: number;
  trackedVessels: number;
  outages: number;
  earthquakes: number;
  displacementOutflow: number;
  climateStress: number;
  conflictEvents: number;
  isTier1: boolean;
}

export class App {
  private container: HTMLElement;
  private readonly PANEL_ORDER_KEY = 'panel-order';
  private map: MapContainer | null = null;
  private tvChart: TradingViewChart | null = null;
  private panels: Record<string, Panel> = {};
  private newsPanels: Record<string, NewsPanel> = {};
  private allNews: NewsItem[] = [];
  private monitors: Monitor[];
  private panelSettings: Record<string, PanelConfig>;
  private mapLayers: MapLayers;
  private playbackControl: PlaybackControl | null = null;
  private statusPanel: StatusPanel | null = null;
  private exportPanel: ExportPanel | null = null;
  private searchModal: SearchModal | null = null;
  private notificationCenter: NotificationCenter | null = null;
  private prevRiskScores = new Map<string, number>();
  private panelFilterDebounceId = 0;
  private latestPredictions: PredictionMarket[] = [];
  private latestMarkets: MarketData[] = [];
  private latestClusters: ClusteredEvent[] = [];
  private isPlaybackMode = false;
  private initialUrlState: ParsedMapUrlState | null = null;
  private inFlight: Set<string> = new Set();
  private isMobile: boolean;
  private seenGeoAlerts: Set<string> = new Set();
  private timeIntervalId: ReturnType<typeof setInterval> | null = null;
  private snapshotIntervalId: ReturnType<typeof setInterval> | null = null;
  private refreshTimeoutIds: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isDestroyed = false;
  private boundKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundFullscreenHandler: (() => void) | null = null;
  private boundResizeHandler: (() => void) | null = null;
  private boundVisibilityHandler: (() => void) | null = null;
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private boundIdleResetHandler: (() => void) | null = null;
  private isIdle = false;
  private readonly IDLE_PAUSE_MS = 2 * 60 * 1000; // 2 minutes - pause animations when idle
  private disabledSources: Set<string> = new Set();
  private mapFlashCache: Map<string, number> = new Map();
  private readonly MAP_FLASH_COOLDOWN_MS = 10 * 60 * 1000;
  private initialLoadComplete = false;
  private bridgeMarketDebounceId: ReturnType<typeof setTimeout> | null = null;
  private bridgeSignalDebounceId: ReturnType<typeof setTimeout> | null = null;
  private lazyFactories = new Map<string, () => Promise<Panel>>();
  private panelObserver: IntersectionObserver | null = null;
  private criticalBannerEl: HTMLElement | null = null;
  private countryBriefPage: CountryBriefPage | null = null;
  private detailPanel: DetailPanel | null = null;
  private countryTimeline: CountryTimeline | null = null;
  private pendingDeepLinkCountry: string | null = null;
  private briefRequestToken = 0;
  private readonly isDesktopApp = isDesktopRuntime();

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container ${containerId} not found`);
    this.container = el;

    this.isMobile = isMobileDevice();
    this.monitors = loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []);

    // Use mobile-specific defaults on first load (no saved layers)
    const defaultLayers = this.isMobile ? MOBILE_DEFAULT_MAP_LAYERS : DEFAULT_MAP_LAYERS;

    // Check if variant changed - reset all settings to variant defaults
    const storedVariant = localStorage.getItem('hq-variant');
    const currentVariant = SITE_VARIANT;
    console.log(`[App] Variant check: stored="${storedVariant}", current="${currentVariant}"`);
    if (storedVariant !== currentVariant) {
      // Variant changed - use defaults for new variant, clear old settings
      console.log('[App] Variant changed - resetting to defaults');
      localStorage.setItem('hq-variant', currentVariant);
      localStorage.removeItem(STORAGE_KEYS.mapLayers);
      localStorage.removeItem(STORAGE_KEYS.panels);
      localStorage.removeItem(this.PANEL_ORDER_KEY);
      this.mapLayers = { ...defaultLayers };
      this.panelSettings = { ...DEFAULT_PANELS };
    } else {
      this.mapLayers = loadFromStorage<MapLayers>(STORAGE_KEYS.mapLayers, defaultLayers);
      this.panelSettings = loadFromStorage<Record<string, PanelConfig>>(
        STORAGE_KEYS.panels,
        DEFAULT_PANELS
      );
      console.log('[App] Loaded panel settings from storage:', Object.entries(this.panelSettings).filter(([_, v]) => !v.enabled).map(([k]) => k));

      // One-time migration: reorder panels for existing users (v3.1 crypto layout)
      // Puts defi-news, defi-protocols, defi-yields, crypto, predictions, open-interest, ai at the top
      const PANEL_ORDER_MIGRATION_KEY = 'hq-panel-order-v3.1';
      if (!localStorage.getItem(PANEL_ORDER_MIGRATION_KEY)) {
        const savedOrder = localStorage.getItem(this.PANEL_ORDER_KEY);
        if (savedOrder) {
          try {
            const order: string[] = JSON.parse(savedOrder);
            // Priority panels that should be at the top (after live-news which is handled separately)
            const priorityPanels = ['defi-news', 'defi-protocol-news', 'defi-yields', 'crypto', 'polymarket', 'open-interest', 'ai'];
            // Remove priority panels from their current positions
            const filtered = order.filter(k => !priorityPanels.includes(k) && k !== 'live-news');
            // Find live-news position (should be first, but just in case)
            const liveNewsIdx = order.indexOf('live-news');
            // Build new order: live-news first, then priority panels, then rest
            const newOrder = liveNewsIdx !== -1 ? ['live-news'] : [];
            newOrder.push(...priorityPanels.filter(p => order.includes(p)));
            newOrder.push(...filtered);
            localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(newOrder));
            console.log('[App] Migrated panel order to v3.1 layout');
          } catch {
            // Invalid saved order, will use defaults
          }
        }
        localStorage.setItem(PANEL_ORDER_MIGRATION_KEY, 'done');
      }

      // Tech variant migration: move insights to top (after live-news)
      if (currentVariant === 'tech') {
        const TECH_INSIGHTS_MIGRATION_KEY = 'hq-tech-insights-top-v1';
        if (!localStorage.getItem(TECH_INSIGHTS_MIGRATION_KEY)) {
          const savedOrder = localStorage.getItem(this.PANEL_ORDER_KEY);
          if (savedOrder) {
            try {
              const order: string[] = JSON.parse(savedOrder);
              // Remove insights from current position
              const filtered = order.filter(k => k !== 'insights' && k !== 'live-news');
              // Build new order: live-news, insights, then rest
              const newOrder: string[] = [];
              if (order.includes('live-news')) newOrder.push('live-news');
              if (order.includes('insights')) newOrder.push('insights');
              newOrder.push(...filtered);
              localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(newOrder));
              console.log('[App] Tech variant: Migrated insights panel to top');
            } catch {
              // Invalid saved order, will use defaults
            }
          }
          localStorage.setItem(TECH_INSIGHTS_MIGRATION_KEY, 'done');
        }
      }
    }

    // Desktop key management panel must always remain accessible in Tauri.
    if (this.isDesktopApp) {
      const runtimePanel = this.panelSettings['runtime-config'] ?? {
        name: 'Desktop Configuration',
        enabled: true,
        priority: 2,
      };
      runtimePanel.enabled = true;
      this.panelSettings['runtime-config'] = runtimePanel;
      saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
    }

    this.initialUrlState = parseMapUrlState(window.location.search, this.mapLayers);
    if (this.initialUrlState.layers) {
      // For tech variant, filter out geopolitical layers from URL
      if (currentVariant === 'tech') {
        const geoLayers: (keyof MapLayers)[] = ['conflicts', 'bases', 'hotspots', 'nuclear', 'irradiators', 'sanctions', 'military', 'protests', 'pipelines', 'waterways', 'ais', 'flights', 'spaceports', 'minerals'];
        const urlLayers = this.initialUrlState.layers;
        geoLayers.forEach(layer => {
          urlLayers[layer] = false;
        });
      }
      this.mapLayers = this.initialUrlState.layers;
    }
    if (!CYBER_LAYER_ENABLED) {
      this.mapLayers.cyberThreats = false;
    }
    this.disabledSources = new Set(loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []));
  }

  public async init(): Promise<void> {
    await initDB();

    // Initialize ML worker (desktop only - automatically disabled on mobile)
    await mlWorker.init();

    // Check AIS configuration before init
    if (!isAisConfigured()) {
      this.mapLayers.ais = false;
    } else if (this.mapLayers.ais) {
      initAisStream();
    }

    this.renderLayout();
    // Notification center
    this.notificationCenter = new NotificationCenter();
    this.notificationCenter.attachBellButton();
    this.notificationCenter.setFlyToHandler((code) => {
      const name = TIER1_COUNTRIES[code] || code;
      this.openCountryBriefByCode(code, name);
    });
    this.setupPlaybackControl();
    this.setupStatusPanel();
    this.setupExportPanel();
    this.setupSearchModal();
    this.setupMapLayerHandlers();
    this.setupCountryAnalysis();
    this.setupEventListeners();
    this.setupPanelFilter();
    if (!this.isMobile) this.setupZoneDrag();
    // Capture ?country= BEFORE URL sync overwrites it
    const initState = parseMapUrlState(window.location.search, this.mapLayers);
    this.pendingDeepLinkCountry = initState.country ?? null;
    this.setupUrlStateSync();
    this.syncDataFreshnessWithLayers();
    await preloadCountryGeometry();
    await this.loadAllData();

    // Start risk scoring learning mode after first data load
    startLearning();

    // Hide unconfigured layers after first data load
    if (!isAisConfigured()) {
      this.map?.hideLayerToggle('ais');
    }
    if (isOutagesConfigured() === false) {
      this.map?.hideLayerToggle('outages');
    }
    if (!CYBER_LAYER_ENABLED) {
      this.map?.hideLayerToggle('cyberThreats');
    }

    this.setupRefreshIntervals();
    this.setupSnapshotSaving();
    cleanOldSnapshots();

    // Start real-time WebSocket price feed (Binance)
    startPriceFeed();

    // Initialise postMessage bridge (no-op when running standalone)
    this.initBridge();

    // Handle deep links for story sharing
    this.handleDeepLinks();
  }

  // -----------------------------------------------------------------------
  // postMessage bridge (host page ↔ HQ)
  // -----------------------------------------------------------------------

  private initBridge(): void {
    const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
    const variant = SITE_VARIANT;
    const activated = hqBridge.init(version, variant);
    if (!activated) return;

    // Register the command handler
    hqBridge.onCommand((type, payload) => this.handleBridgeCommand(type, payload));
  }

  private handleBridgeCommand(type: HQCommandType, payload: unknown): void {
    switch (type) {
      case 'host:apply-template': {
        const p = payload as Partial<ApplyTemplatePayload> | null;
        if (p && typeof p.id === 'string') {
          this.applyTemplateById(p.id);
        }
        break;
      }
      case 'host:toggle-panel': {
        const p = payload as Partial<TogglePanelPayload> | null;
        if (p && typeof p.key === 'string' && typeof p.enabled === 'boolean') {
          const config = this.panelSettings[p.key];
          if (config && config.enabled !== p.enabled) {
            config.enabled = p.enabled;
            saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
            this.applyPanelSettings();
            this.renderPanelToggles();
            this.updateAddbackFab();
          }
        }
        break;
      }
      case 'host:fly-to-country': {
        const p = payload as Partial<FlyToCountryPayload> | null;
        if (p && typeof p.lat === 'number' && typeof p.lon === 'number') {
          this.map?.setCenter(p.lat, p.lon, typeof p.zoom === 'number' ? p.zoom : 4);
        }
        break;
      }
      case 'host:set-theme': {
        // Future: theme switching support
        break;
      }
      case 'host:request-state': {
        const activeTemplateId = localStorage.getItem(STORAGE_KEYS.activeTemplate) ?? 'default';
        const btc = this.latestMarkets.find(m => m.symbol === 'BINANCE:BTCUSDT' || m.name?.toLowerCase().includes('bitcoin'));
        const topMovers = [...this.latestMarkets]
          .filter(m => m.change !== null)
          .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
          .slice(0, 5)
          .map(m => ({ symbol: m.symbol, change: m.change }));

        hqBridge.emit('hq:market-update', {
          btcPrice: btc?.price ?? null,
          btcChange: btc?.change ?? null,
          topMovers,
        });
        hqBridge.emit('hq:template-changed', { id: activeTemplateId, name: activeTemplateId });

        // Also send panel states
        for (const [key, cfg] of Object.entries(this.panelSettings)) {
          hqBridge.emitPanelToggled(key, cfg.enabled);
        }
        break;
      }
      case 'host:show-panel': {
        const p = payload as Partial<ShowPanelPayload> | null;
        if (p && typeof p.key === 'string') {
          const panel = this.panels[p.key];
          if (panel) {
            // Ensure visible
            const cfg = this.panelSettings[p.key];
            if (cfg && !cfg.enabled) {
              cfg.enabled = true;
              saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
              this.applyPanelSettings();
              this.renderPanelToggles();
              this.updateAddbackFab();
            }
            panel.getElement().scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        break;
      }
    }
  }

  /** Debounced bridge emit for market updates (max 1/minute). */
  private emitBridgeMarketUpdate(): void {
    if (!hqBridge.isActive) return;
    if (this.bridgeMarketDebounceId) return; // already scheduled
    this.bridgeMarketDebounceId = setTimeout(() => {
      this.bridgeMarketDebounceId = null;
      const btc = this.latestMarkets.find(m => m.symbol === 'BINANCE:BTCUSDT' || m.name?.toLowerCase().includes('bitcoin'));
      const topMovers = [...this.latestMarkets]
        .filter(m => m.change !== null)
        .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
        .slice(0, 5)
        .map(m => ({ symbol: m.symbol, change: m.change }));
      hqBridge.emitMarketUpdate({
        btcPrice: btc?.price ?? null,
        btcChange: btc?.change ?? null,
        topMovers,
      });
    }, 60_000);
  }

  /** Debounced bridge emit for signal detection (max 1/minute). */
  private emitBridgeSignalDetected(): void {
    if (!hqBridge.isActive) return;
    if (this.bridgeSignalDebounceId) return; // already scheduled
    this.bridgeSignalDebounceId = setTimeout(() => {
      this.bridgeSignalDebounceId = null;
      const summary = signalAggregator.getSummary();
      const topCountries = signalAggregator.getCountryClusters().slice(0, 5).map(c => ({
        country: c.country,
        name: c.countryName,
        score: c.convergenceScore,
      }));
      hqBridge.emitSignalDetected({
        summary: summary.aiContext,
        topCountries,
        convergenceZones: signalAggregator.getRegionalConvergence().length,
      });
    }, 60_000);
  }

  private handleDeepLinks(): void {
    const url = new URL(window.location.href);

    // Check for story deep link: /story?c=UA&t=ciianalysis
    if (url.pathname === '/story' || url.searchParams.has('c')) {
      const countryCode = url.searchParams.get('c');
      if (countryCode) {
        const countryNames: Record<string, string> = {
          UA: 'Ukraine', RU: 'Russia', CN: 'China', US: 'United States',
          IR: 'Iran', IL: 'Israel', TW: 'Taiwan', KP: 'North Korea',
          SA: 'Saudi Arabia', TR: 'Turkey', PL: 'Poland', DE: 'Germany',
          FR: 'France', GB: 'United Kingdom', IN: 'India', PK: 'Pakistan',
          SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
        };
        const countryName = countryNames[countryCode.toUpperCase()] || countryCode;

        // Wait for data to load, then open story
        const checkAndOpen = () => {
          if (dataFreshness.hasSufficientData() && this.latestClusters.length > 0) {
            this.openCountryStory(countryCode.toUpperCase(), countryName);
          } else {
            setTimeout(checkAndOpen, 500);
          }
        };
        setTimeout(checkAndOpen, 2000);

        // Update URL without reload
        history.replaceState(null, '', '/');
        return;
      }
    }

    // Check for country brief deep link: ?country=UA (captured before URL sync)
    const deepLinkCountry = this.pendingDeepLinkCountry;
    this.pendingDeepLinkCountry = null;
    if (deepLinkCountry) {
      const cName = App.resolveCountryName(deepLinkCountry);
      const checkAndOpenBrief = () => {
        if (dataFreshness.hasSufficientData()) {
          this.openCountryBriefByCode(deepLinkCountry, cName);
        } else {
          setTimeout(checkAndOpenBrief, 500);
        }
      };
      setTimeout(checkAndOpenBrief, 2000);
    }
  }

  private setupStatusPanel(): void {
    this.statusPanel = new StatusPanel();
    const headerLeft = this.container.querySelector('.header-left');
    if (headerLeft) {
      headerLeft.appendChild(this.statusPanel.getElement());

      // WebSocket live price status indicator
      const wsStatus = document.createElement('span');
      wsStatus.className = 'ws-status';
      wsStatus.innerHTML = '<span class="ws-status-dot disconnected"></span><span class="ws-status-label disconnected">Offline</span>';
      headerLeft.appendChild(wsStatus);
      window.addEventListener('ws:status', ((e: Event) => {
        const { status } = (e as CustomEvent<{ status: string }>).detail;
        const dot = wsStatus.querySelector('.ws-status-dot') as HTMLElement;
        const label = wsStatus.querySelector('.ws-status-label') as HTMLElement;
        if (!dot || !label) return;
        dot.className = `ws-status-dot ${status === 'connected' ? 'live' : status}`;
        label.className = `ws-status-label ${status === 'connected' ? 'live' : status}`;
        label.textContent = status === 'connected' ? 'Live' : status === 'reconnecting' ? 'Reconnecting' : 'Offline';
      }));
    }
  }

  private setupExportPanel(): void {
    this.exportPanel = new ExportPanel(() => ({
      news: this.latestClusters.length > 0 ? this.latestClusters : this.allNews,
      markets: this.latestMarkets,
      predictions: this.latestPredictions,
      timestamp: Date.now(),
    }));

    const headerRight = this.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(this.exportPanel.getElement(), headerRight.firstChild);
    }
  }

  private syncDataFreshnessWithLayers(): void {
    // Map layer toggles to data source IDs
    const layerToSource: Partial<Record<keyof MapLayers, DataSourceId[]>> = {
      military: ['opensky', 'wingbits'],
      ais: ['ais'],
      natural: ['usgs'],
      weather: ['weather'],
      outages: ['outages'],
      cyberThreats: ['cyber_threats'],
      protests: ['acled'],
      ucdpEvents: ['ucdp_events'],
      displacement: ['unhcr'],
      climate: ['climate'],
    };

    for (const [layer, sourceIds] of Object.entries(layerToSource)) {
      const enabled = this.mapLayers[layer as keyof MapLayers] ?? false;
      for (const sourceId of sourceIds) {
        dataFreshness.setEnabled(sourceId as DataSourceId, enabled);
      }
    }

    // Mark sources as disabled if not configured
    if (!isAisConfigured()) {
      dataFreshness.setEnabled('ais', false);
    }
    if (isOutagesConfigured() === false) {
      dataFreshness.setEnabled('outages', false);
    }
  }

  private setupMapLayerHandlers(): void {
    this.map?.setOnLayerChange((layer, enabled) => {
      console.log(`[App.onLayerChange] ${layer}: ${enabled}`);
      // Save layer settings
      this.mapLayers[layer] = enabled;
      saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);

      // Sync data freshness tracker
      const layerToSource: Partial<Record<keyof MapLayers, DataSourceId[]>> = {
        military: ['opensky', 'wingbits'],
        ais: ['ais'],
        natural: ['usgs'],
        weather: ['weather'],
        outages: ['outages'],
        cyberThreats: ['cyber_threats'],
        protests: ['acled'],
        ucdpEvents: ['ucdp_events'],
        displacement: ['unhcr'],
        climate: ['climate'],
      };
      const sourceIds = layerToSource[layer];
      if (sourceIds) {
        for (const sourceId of sourceIds) {
          dataFreshness.setEnabled(sourceId, enabled);
        }
      }

      // Handle AIS WebSocket connection
      if (layer === 'ais') {
        if (enabled) {
          this.map?.setLayerLoading('ais', true);
          initAisStream();
          this.waitForAisData();
        } else {
          disconnectAisStream();
        }
        return;
      }

      // Load data when layer is enabled (if not already loaded)
      if (enabled) {
        this.loadDataForLayer(layer);
      }
    });
  }

  private setupCountryAnalysis(): void {
    if (!this.map) return;
    this.countryBriefPage = new CountryBriefPage();

    // Detail Panel slide-over
    this.detailPanel = new DetailPanel();
    window.addEventListener('detail:open', ((e: CustomEvent<DetailOpenEvent>) => {
      this.detailPanel?.open(e.detail.type, e.detail.data);
    }) as EventListener);

    window.addEventListener('detail:fly-to', ((e: CustomEvent<{ lat: number; lon: number }>) => {
      this.detailPanel?.close();
      this.map?.setCenter(e.detail.lat, e.detail.lon, 4);
    }) as EventListener);

    window.addEventListener('country:open-brief', ((e: CustomEvent<{ code: string; name: string }>) => {
      this.detailPanel?.close();
      this.openCountryBriefByCode(e.detail.code, e.detail.name);
    }) as EventListener);

    this.countryBriefPage.setShareStoryHandler((code, name) => {
      this.countryBriefPage?.hide();
      this.openCountryStory(code, name);
    });
    this.countryBriefPage.setExportImageHandler(async (code, name) => {
      try {
        const signals = this.getCountrySignals(code, name);
        const cluster = signalAggregator.getCountryClusters().find(c => c.country === code);
        const regional = signalAggregator.getRegionalConvergence().filter(r => r.countries.includes(code));
        const convergence = cluster ? {
          score: cluster.convergenceScore,
          signalTypes: [...cluster.signalTypes],
          regionalDescriptions: regional.map(r => r.description),
        } : null;
        const posturePanel = this.panels['sector-overview'] as import('@/components/StrategicPosturePanel').StrategicPosturePanel | undefined;
        const postures = posturePanel?.getPostures() || [];
        const data = collectStoryData(code, name, this.latestClusters, postures, this.latestPredictions, signals, convergence);
        const canvas = await renderStoryToCanvas(data);
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `country-brief-${code.toLowerCase()}-${Date.now()}.png`;
        a.click();
      } catch (err) {
        console.error('[CountryBrief] Image export failed:', err);
      }
    });

    this.map.onCountryClicked(async (countryClick) => {
      if (countryClick.code && countryClick.name) {
        this.openCountryBriefByCode(countryClick.code, countryClick.name);
        hqBridge.emitCountrySelected(countryClick.code, countryClick.name);
      } else {
        this.openCountryBrief(countryClick.lat, countryClick.lon);
      }
    });

    this.countryBriefPage.onClose(() => {
      this.briefRequestToken++; // invalidate any in-flight reverse-geocode
      this.map?.clearCountryHighlight();
      this.map?.setRenderPaused(false);
      this.countryTimeline?.destroy();
      this.countryTimeline = null;
      // Force URL rewrite to drop ?country= immediately
      const shareUrl = this.getShareUrl();
      if (shareUrl) history.replaceState(null, '', shareUrl);
    });
  }

  public async openCountryBrief(lat: number, lon: number): Promise<void> {
    if (!this.countryBriefPage) return;
    const token = ++this.briefRequestToken;
    this.countryBriefPage.showLoading();
    this.map?.setRenderPaused(true);

    const localGeo = getCountryAtCoordinates(lat, lon);
    if (localGeo) {
      if (token !== this.briefRequestToken) return; // superseded by newer click
      this.openCountryBriefByCode(localGeo.code, localGeo.name);
      return;
    }

    const geo = await reverseGeocode(lat, lon);
    if (token !== this.briefRequestToken) return; // superseded by newer click
    if (!geo) {
      this.countryBriefPage.hide();
      this.map?.setRenderPaused(false);
      return;
    }

    this.openCountryBriefByCode(geo.code, geo.country);
  }

  public async openCountryBriefByCode(code: string, country: string): Promise<void> {
    if (!this.countryBriefPage) return;
    this.map?.setRenderPaused(true);

    // Normalize to canonical name (GeoJSON may use "United States of America" etc.)
    const canonicalName = TIER1_COUNTRIES[code] || App.resolveCountryName(code);
    if (canonicalName !== code) country = canonicalName;

    const scores = calculateRiskScores();
    const score = scores.find((s) => s.code === code) ?? null;
    const signals = this.getCountrySignals(code, country);

    this.countryBriefPage.show(country, code, score, signals);
    this.map?.highlightCountry(code);

    // Force URL to include ?country= immediately
    const shareUrl = this.getShareUrl();
    if (shareUrl) history.replaceState(null, '', shareUrl);

    const stockPromise = fetch(`/api/stock-index?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .catch(() => ({ available: false }));

    stockPromise.then((stock) => {
      if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateStock(stock);
    });

    fetchCountryMarkets(country)
      .then((markets) => {
        if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateMarkets(markets);
      })
      .catch(() => {
        if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateMarkets([]);
      });

    // Pass evidence headlines
    const searchTerms = App.getCountrySearchTerms(country, code);
    const otherCountryTerms = App.getOtherCountryTerms(code);
    const matchingNews = this.allNews.filter((n) => {
      const t = n.title.toLowerCase();
      return searchTerms.some((term) => t.includes(term));
    });
    const filteredNews = matchingNews.filter((n) => {
      const t = n.title.toLowerCase();
      const ourPos = App.firstMentionPosition(t, searchTerms);
      const otherPos = App.firstMentionPosition(t, otherCountryTerms);
      return ourPos !== Infinity && (otherPos === Infinity || ourPos <= otherPos);
    });
    if (filteredNews.length > 0) {
      this.countryBriefPage.updateNews(filteredNews.slice(0, 8));
    }

    // Infrastructure exposure
    this.countryBriefPage.updateInfrastructure(code);

    // Timeline
    this.mountCountryTimeline(code, country);

    try {
      const context: Record<string, unknown> = {};
      if (score) {
        context.score = score.score;
        context.level = score.level;
        context.trend = score.trend;
        context.components = score.components;
        context.change24h = score.change24h;
      }
      Object.assign(context, signals);

      const countryCluster = signalAggregator.getCountryClusters().find((c) => c.country === code);
      if (countryCluster) {
        context.convergenceScore = countryCluster.convergenceScore;
        context.signalTypes = [...countryCluster.signalTypes];
      }

      const convergences = signalAggregator.getRegionalConvergence()
        .filter((r) => r.countries.includes(code));
      if (convergences.length) {
        context.regionalConvergence = convergences.map((r) => r.description);
      }

      const headlines = filteredNews.slice(0, 15).map((n) => n.title);
      if (headlines.length) context.headlines = headlines;

      const stockData = await stockPromise;
      if (stockData.available) {
        const pct = parseFloat(stockData.weekChangePercent);
        context.stockIndex = `${stockData.indexName}: ${stockData.price} (${pct >= 0 ? '+' : ''}${stockData.weekChangePercent}% week)`;
      }

      let data: Record<string, unknown> | null = null;
      try {
        const res = await fetch('/api/country-intel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, code, context }),
        });
        data = await res.json();
      } catch { /* server unreachable */ }

      if (data && data.brief && !data.skipped) {
        this.countryBriefPage!.updateBrief({ ...data, code } as Parameters<typeof this.countryBriefPage.updateBrief>[0]);
      } else {
        const briefHeadlines = (context.headlines as string[] | undefined) || [];
        let fallbackBrief = '';
        if (briefHeadlines.length >= 2 && mlWorker.isAvailable) {
          try {
            const prompt = `Summarize the current situation in ${country} based on these headlines: ${briefHeadlines.slice(0, 8).join('. ')}`;
            const [summary] = await mlWorker.summarize([prompt]);
            if (summary && summary.length > 20) fallbackBrief = summary;
          } catch { /* T5 failed */ }
        }

        if (fallbackBrief) {
          this.countryBriefPage!.updateBrief({ brief: fallbackBrief, country, code, fallback: true });
        } else {
          const lines: string[] = [];
          if (score) lines.push(`**Risk Index: ${score.score}/100** (${score.level}, ${score.trend})`);
          if (signals.protests > 0) lines.push(`${signals.protests} active governance proposals detected`);
          if (signals.trackedFlights > 0) lines.push(`${signals.trackedFlights} whale transactions tracked`);
          if (signals.trackedVessels > 0) lines.push(`${signals.trackedVessels} protocol exploits tracked`);
          if (signals.outages > 0) lines.push(`${signals.outages} network outages`);
          if (signals.earthquakes > 0) lines.push(`${signals.earthquakes} recent market events`);
          if (context.stockIndex) lines.push(`Stock index: ${context.stockIndex}`);
          if (briefHeadlines.length > 0) {
            lines.push('', '**Recent headlines:**');
            briefHeadlines.slice(0, 5).forEach(h => lines.push(`• ${h}`));
          }
          if (lines.length > 0) {
            this.countryBriefPage!.updateBrief({ brief: lines.join('\n'), country, code, fallback: true });
          } else {
            this.countryBriefPage!.updateBrief({ brief: '', country, code, error: 'No AI service available. Configure GROQ_API_KEY in Settings for full briefs.' });
          }
        }
      }
    } catch (err) {
      console.error('[CountryBrief] fetch error:', err);
      this.countryBriefPage!.updateBrief({ brief: '', country, code, error: 'Failed to generate brief' });
    }
  }

  private mountCountryTimeline(code: string, country: string): void {
    this.countryTimeline?.destroy();
    this.countryTimeline = null;

    const mount = this.countryBriefPage?.getTimelineMount();
    if (!mount) return;

    const events: TimelineEvent[] = [];
    const countryLower = country.toLowerCase();
    const hasGeoShape = hasCountryGeometry(code) || !!App.COUNTRY_BOUNDS[code];
    const inCountry = (lat: number, lon: number) => hasGeoShape && this.isInCountry(lat, lon, code);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    if (this.signalCache.protests?.events) {
      for (const e of this.signalCache.protests.events) {
        if (e.country?.toLowerCase() === countryLower || inCountry(e.lat, e.lon)) {
          events.push({
            timestamp: new Date(e.time).getTime(),
            lane: 'protest',
            label: e.title || `${e.eventType} in ${e.city || e.country}`,
            severity: e.severity === 'high' ? 'high' : e.severity === 'medium' ? 'medium' : 'low',
          });
        }
      }
    }

    if (this.signalCache.earthquakes) {
      for (const eq of this.signalCache.earthquakes) {
        if (inCountry(eq.lat, eq.lon) || eq.place?.toLowerCase().includes(countryLower)) {
          events.push({
            timestamp: new Date(eq.time).getTime(),
            lane: 'natural',
            label: `M${eq.magnitude.toFixed(1)} ${eq.place}`,
            severity: eq.magnitude >= 6 ? 'critical' : eq.magnitude >= 5 ? 'high' : eq.magnitude >= 4 ? 'medium' : 'low',
          });
        }
      }
    }

    if (this.signalCache.tracking) {
      for (const f of this.signalCache.tracking.flights) {
        if (hasGeoShape ? this.isInCountry(f.lat, f.lon, code) : f.operatorCountry?.toUpperCase() === code) {
          events.push({
            timestamp: new Date(f.lastSeen).getTime(),
            lane: 'military',
            label: `${f.callsign} (${f.aircraftModel || f.aircraftType})`,
            severity: f.isInteresting ? 'high' : 'low',
          });
        }
      }
      for (const v of this.signalCache.tracking.vessels) {
        if (hasGeoShape ? this.isInCountry(v.lat, v.lon, code) : v.operatorCountry?.toUpperCase() === code) {
          events.push({
            timestamp: new Date(v.lastAisUpdate).getTime(),
            lane: 'military',
            label: `${v.name} (${v.vesselType})`,
            severity: v.isDark ? 'high' : 'low',
          });
        }
      }
    }

    const ciiData = getCountryData(code);
    if (ciiData?.conflicts) {
      for (const c of ciiData.conflicts) {
        events.push({
          timestamp: new Date(c.time).getTime(),
          lane: 'conflict',
          label: `${c.eventType}: ${c.location || c.country}`,
          severity: c.fatalities > 0 ? 'critical' : 'high',
        });
      }
    }

    this.countryTimeline = new CountryTimeline(mount);
    this.countryTimeline.render(events.filter(e => e.timestamp >= sevenDaysAgo));
  }

  private static COUNTRY_BOUNDS: Record<string, { n: number; s: number; e: number; w: number }> = {
    IR: { n: 40, s: 25, e: 63, w: 44 }, IL: { n: 33.3, s: 29.5, e: 35.9, w: 34.3 },
    SA: { n: 32, s: 16, e: 55, w: 35 }, AE: { n: 26.1, s: 22.6, e: 56.4, w: 51.6 },
    IQ: { n: 37.4, s: 29.1, e: 48.6, w: 38.8 }, SY: { n: 37.3, s: 32.3, e: 42.4, w: 35.7 },
    YE: { n: 19, s: 12, e: 54.5, w: 42 }, LB: { n: 34.7, s: 33.1, e: 36.6, w: 35.1 },
    CN: { n: 53.6, s: 18.2, e: 134.8, w: 73.5 }, TW: { n: 25.3, s: 21.9, e: 122, w: 120 },
    JP: { n: 45.5, s: 24.2, e: 153.9, w: 122.9 }, KR: { n: 38.6, s: 33.1, e: 131.9, w: 124.6 },
    KP: { n: 43.0, s: 37.7, e: 130.7, w: 124.2 }, IN: { n: 35.5, s: 6.7, e: 97.4, w: 68.2 },
    PK: { n: 37, s: 24, e: 77, w: 61 }, AF: { n: 38.5, s: 29.4, e: 74.9, w: 60.5 },
    UA: { n: 52.4, s: 44.4, e: 40.2, w: 22.1 }, RU: { n: 82, s: 41.2, e: 180, w: 19.6 },
    BY: { n: 56.2, s: 51.3, e: 32.8, w: 23.2 }, PL: { n: 54.8, s: 49, e: 24.1, w: 14.1 },
    EG: { n: 31.7, s: 22, e: 36.9, w: 25 }, LY: { n: 33, s: 19.5, e: 25, w: 9.4 },
    SD: { n: 22, s: 8.7, e: 38.6, w: 21.8 }, US: { n: 49, s: 24.5, e: -66.9, w: -125 },
    GB: { n: 58.7, s: 49.9, e: 1.8, w: -8.2 }, DE: { n: 55.1, s: 47.3, e: 15.0, w: 5.9 },
    FR: { n: 51.1, s: 41.3, e: 9.6, w: -5.1 }, TR: { n: 42.1, s: 36, e: 44.8, w: 26 },
    BR: { n: 5.3, s: -33.8, e: -34.8, w: -73.9 },
  };

  private static COUNTRY_ALIASES: Record<string, string[]> = {
    IL: ['israel', 'israeli', 'gaza', 'hamas', 'hezbollah', 'netanyahu', 'idf', 'west bank', 'tel aviv', 'jerusalem'],
    IR: ['iran', 'iranian', 'tehran', 'persian', 'irgc', 'khamenei'],
    RU: ['russia', 'russian', 'moscow', 'kremlin', 'putin', 'ukraine war'],
    UA: ['ukraine', 'ukrainian', 'kyiv', 'zelensky', 'zelenskyy'],
    CN: ['china', 'chinese', 'beijing', 'taiwan strait', 'south china sea', 'xi jinping'],
    TW: ['taiwan', 'taiwanese', 'taipei'],
    KP: ['north korea', 'pyongyang', 'kim jong'],
    KR: ['south korea', 'seoul'],
    SA: ['saudi', 'riyadh', 'mbs'],
    SY: ['syria', 'syrian', 'damascus', 'assad'],
    YE: ['yemen', 'houthi', 'sanaa'],
    IQ: ['iraq', 'iraqi', 'baghdad'],
    AF: ['afghanistan', 'afghan', 'kabul', 'taliban'],
    PK: ['pakistan', 'pakistani', 'islamabad'],
    IN: ['india', 'indian', 'new delhi', 'modi'],
    EG: ['egypt', 'egyptian', 'cairo', 'suez'],
    LB: ['lebanon', 'lebanese', 'beirut'],
    TR: ['turkey', 'turkish', 'ankara', 'erdogan', 'türkiye'],
    US: ['united states', 'american', 'washington', 'pentagon', 'white house'],
    GB: ['united kingdom', 'british', 'london', 'uk '],
    BR: ['brazil', 'brazilian', 'brasilia', 'lula', 'bolsonaro'],
    AE: ['united arab emirates', 'uae', 'emirati', 'dubai', 'abu dhabi'],
  };

  private static otherCountryTermsCache: Map<string, string[]> = new Map();

  private static firstMentionPosition(text: string, terms: string[]): number {
    let earliest = Infinity;
    for (const term of terms) {
      const idx = text.indexOf(term);
      if (idx !== -1 && idx < earliest) earliest = idx;
    }
    return earliest;
  }

  private static getOtherCountryTerms(code: string): string[] {
    const cached = App.otherCountryTermsCache.get(code);
    if (cached) return cached;

    const dedup = new Set<string>();
    Object.entries(App.COUNTRY_ALIASES).forEach(([countryCode, aliases]) => {
      if (countryCode === code) return;
      aliases.forEach((alias) => {
        const normalized = alias.toLowerCase();
        if (normalized.trim().length > 0) dedup.add(normalized);
      });
    });

    const terms = [...dedup];
    App.otherCountryTermsCache.set(code, terms);
    return terms;
  }

  private static resolveCountryName(code: string): string {
    if (TIER1_COUNTRIES[code]) return TIER1_COUNTRIES[code];

    try {
      const displayNamesCtor = (Intl as unknown as { DisplayNames?: IntlDisplayNamesCtor }).DisplayNames;
      if (!displayNamesCtor) return code;
      const displayNames = new displayNamesCtor(['en'], { type: 'region' });
      const resolved = displayNames.of(code);
      if (resolved && resolved.toUpperCase() !== code) return resolved;
    } catch {
      // Intl.DisplayNames unavailable in older runtimes.
    }

    return code;
  }

  private static getCountrySearchTerms(country: string, code: string): string[] {
    const aliases = App.COUNTRY_ALIASES[code];
    if (aliases) return aliases;
    if (/^[A-Z]{2}$/i.test(country.trim())) return [];
    return [country.toLowerCase()];
  }

  private isInCountry(lat: number, lon: number, code: string): boolean {
    const precise = isCoordinateInCountry(lat, lon, code);
    if (precise != null) return precise;
    const b = App.COUNTRY_BOUNDS[code];
    if (!b) return false;
    return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
  }

  private getCountrySignals(code: string, country: string): CountryBriefSignals {
    const countryLower = country.toLowerCase();
    const hasGeoShape = hasCountryGeometry(code) || !!App.COUNTRY_BOUNDS[code];

    let protests = 0;
    if (this.signalCache.protests?.events) {
      protests = this.signalCache.protests.events.filter((e) =>
        e.country?.toLowerCase() === countryLower || (hasGeoShape && this.isInCountry(e.lat, e.lon, code))
      ).length;
    }

    let trackedFlights = 0;
    let trackedVessels = 0;
    if (this.signalCache.tracking) {
      trackedFlights = this.signalCache.tracking.flights.filter((f) =>
        hasGeoShape ? this.isInCountry(f.lat, f.lon, code) : f.operatorCountry?.toUpperCase() === code
      ).length;
      trackedVessels = this.signalCache.tracking.vessels.filter((v) =>
        hasGeoShape ? this.isInCountry(v.lat, v.lon, code) : v.operatorCountry?.toUpperCase() === code
      ).length;
    }

    let outages = 0;
    if (this.signalCache.outages) {
      outages = this.signalCache.outages.filter((o) =>
        o.country?.toLowerCase() === countryLower || (hasGeoShape && this.isInCountry(o.lat, o.lon, code))
      ).length;
    }

    let earthquakes = 0;
    if (this.signalCache.earthquakes) {
      earthquakes = this.signalCache.earthquakes.filter((eq) => {
        if (hasGeoShape) return this.isInCountry(eq.lat, eq.lon, code);
        return eq.place?.toLowerCase().includes(countryLower);
      }).length;
    }

    const ciiData = getCountryData(code);
    const isTier1 = !!TIER1_COUNTRIES[code];

    return {
      protests,
      trackedFlights,
      trackedVessels,
      outages,
      earthquakes,
      displacementOutflow: ciiData?.displacementOutflow ?? 0,
      climateStress: ciiData?.climateStress ?? 0,
      conflictEvents: ciiData?.conflicts?.length ?? 0,
      isTier1,
    };
  }

  private openCountryStory(code: string, name: string): void {
    if (!dataFreshness.hasSufficientData() || this.latestClusters.length === 0) {
      this.showToast('Data still loading - try again in a moment');
      return;
    }
    const posturePanel = this.panels['sector-overview'] as StrategicPosturePanel | undefined;
    const postures = posturePanel?.getPostures() || [];
    const signals = this.getCountrySignals(code, name);
    const cluster = signalAggregator.getCountryClusters().find(c => c.country === code);
    const regional = signalAggregator.getRegionalConvergence().filter(r => r.countries.includes(code));
    const convergence = cluster ? {
      score: cluster.convergenceScore,
      signalTypes: [...cluster.signalTypes],
      regionalDescriptions: regional.map(r => r.description),
    } : null;
    const data = collectStoryData(code, name, this.latestClusters, postures, this.latestPredictions, signals, convergence);
    openStoryModal(data);
  }

  private showToast(msg: string): void {
    document.querySelector('.toast-notification')?.remove();
    const el = document.createElement('div');
    el.className = 'toast-notification';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 3000);
  }

  private setupSearchModal(): void {
    const searchOptions = SITE_VARIANT === 'tech'
      ? {
          placeholder: 'Search companies, AI labs, startups, events...',
          hint: 'HQs • Companies • AI Labs • Startups • Accelerators • Events',
        }
      : {
          placeholder: 'Search news, DeFi, tokens, markets...',
          hint: 'News • Countries • DeFi • Crypto • Tokens • Markets • Yields • Protocols',
        };
    this.searchModal = new SearchModal(this.container, searchOptions);

    if (SITE_VARIANT === 'tech') {
      // Tech variant: tech-specific sources
      this.searchModal.registerSource('techcompany', TECH_COMPANIES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.sector} ${c.city} ${c.keyProducts?.join(' ') || ''}`.trim(),
        data: c,
      })));

      this.searchModal.registerSource('ailab', AI_RESEARCH_LABS.map(l => ({
        id: l.id,
        title: l.name,
        subtitle: `${l.type} ${l.city} ${l.focusAreas?.join(' ') || ''}`.trim(),
        data: l,
      })));

      this.searchModal.registerSource('startup', STARTUP_ECOSYSTEMS.map(s => ({
        id: s.id,
        title: s.name,
        subtitle: `${s.ecosystemTier} ${s.topSectors?.join(' ') || ''} ${s.notableStartups?.join(' ') || ''}`.trim(),
        data: s,
      })));

      this.searchModal.registerSource('datacenter', AI_DATA_CENTERS.map(d => ({
        id: d.id,
        title: d.name,
        subtitle: `${d.owner} ${d.chipType || ''}`.trim(),
        data: d,
      })));

      this.searchModal.registerSource('cable', UNDERSEA_CABLES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: c.major ? 'Major DeFi protocol' : 'Cross-chain bridge',
        data: c,
      })));

      // Register Tech HQs (unicorns, FAANG, public companies from map)
      this.searchModal.registerSource('techhq', TECH_HQS.map(h => ({
        id: h.id,
        title: h.company,
        subtitle: `${h.type === 'faang' ? 'Big Tech' : h.type === 'unicorn' ? 'Unicorn' : 'Public'} • ${h.city}, ${h.country}`,
        data: h,
      })));

      // Register Accelerators
      this.searchModal.registerSource('accelerator', ACCELERATORS.map(a => ({
        id: a.id,
        title: a.name,
        subtitle: `${a.type} • ${a.city}, ${a.country}${a.notable ? ` • ${a.notable.slice(0, 2).join(', ')}` : ''}`,
        data: a,
      })));
    } else {
      // Full variant: geopolitical sources
      this.searchModal.registerSource('hotspot', FOCUS_AREAS.map(h => ({
        id: h.id,
        title: h.name,
        subtitle: `${h.subtext || ''} ${h.keywords?.join(' ') || ''} ${h.description || ''}`.trim(),
        data: h,
      })));

      this.searchModal.registerSource('conflict', RISK_REGIONS.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.parties?.join(' ') || ''} ${c.keywords?.join(' ') || ''} ${c.description || ''}`.trim(),
        data: c,
      })));

      this.searchModal.registerSource('base', TRACKED_FACILITIES.map(b => ({
        id: b.id,
        title: b.name,
        subtitle: `${b.type} ${b.description || ''}`.trim(),
        data: b,
      })));

      this.searchModal.registerSource('pipeline', PIPELINES.map(p => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.type} ${p.operator || ''} ${p.countries?.join(' ') || ''}`.trim(),
        data: p,
      })));

      this.searchModal.registerSource('cable', UNDERSEA_CABLES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: c.major ? 'Major protocol' : '',
        data: c,
      })));

      this.searchModal.registerSource('datacenter', AI_DATA_CENTERS.map(d => ({
        id: d.id,
        title: d.name,
        subtitle: `${d.owner} ${d.chipType || ''}`.trim(),
        data: d,
      })));

      this.searchModal.registerSource('nuclear', ENERGY_FACILITIES.map(n => ({
        id: n.id,
        title: n.name,
        subtitle: `${n.type} ${n.operator || ''}`.trim(),
        data: n,
      })));

      this.searchModal.registerSource('irradiator', GAMMA_IRRADIATORS.map(g => ({
        id: g.id,
        title: `${g.city}, ${g.country}`,
        subtitle: g.organization || '',
        data: g,
      })));
    }

    // Register countries for both variants
    this.searchModal.registerSource('country', this.buildCountrySearchItems());

    // Handle result selection
    this.searchModal.setOnSelect((result) => this.handleSearchResult(result));

    // Global keyboard shortcut
    this.boundKeydownHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (this.searchModal?.isOpen()) {
          this.searchModal.close();
        } else {
          // Update search index with latest data before opening
          this.updateSearchIndex();
          this.searchModal?.open();
        }
      }
    };
    document.addEventListener('keydown', this.boundKeydownHandler);
  }

  private handleSearchResult(result: SearchResult): void {
    switch (result.type) {
      case 'news': {
        // Find and scroll to the news panel containing this item
        const item = result.data as NewsItem;
        this.scrollToPanel('politics');
        this.highlightNewsItem(item.link);
        break;
      }
      case 'hotspot': {
        // Trigger map popup for hotspot
        const hotspot = result.data as typeof FOCUS_AREAS[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.triggerHotspotClick(hotspot.id);
        }, 300);
        break;
      }
      case 'conflict': {
        const conflict = result.data as typeof RISK_REGIONS[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.triggerConflictClick(conflict.id);
        }, 300);
        break;
      }
      case 'market': {
        this.scrollToPanel('markets');
        break;
      }
      case 'prediction': {
        this.scrollToPanel('polymarket');
        break;
      }
      case 'base': {
        const base = result.data as typeof TRACKED_FACILITIES[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.triggerBaseClick(base.id);
        }, 300);
        break;
      }
      case 'pipeline': {
        const pipeline = result.data as typeof PIPELINES[0];
        this.map?.setView('global');
        this.map?.enableLayer('pipelines');
        this.mapLayers.pipelines = true;
        setTimeout(() => {
          this.map?.triggerPipelineClick(pipeline.id);
        }, 300);
        break;
      }
      case 'cable': {
        const cable = result.data as typeof UNDERSEA_CABLES[0];
        this.map?.setView('global');
        this.map?.enableLayer('cables');
        this.mapLayers.cables = true;
        setTimeout(() => {
          this.map?.triggerCableClick(cable.id);
        }, 300);
        break;
      }
      case 'datacenter': {
        const dc = result.data as typeof AI_DATA_CENTERS[0];
        this.map?.setView('global');
        this.map?.enableLayer('datacenters');
        this.mapLayers.datacenters = true;
        setTimeout(() => {
          this.map?.triggerDatacenterClick(dc.id);
        }, 300);
        break;
      }
      case 'nuclear': {
        const nuc = result.data as typeof ENERGY_FACILITIES[0];
        this.map?.setView('global');
        this.map?.enableLayer('nuclear');
        this.mapLayers.nuclear = true;
        setTimeout(() => {
          this.map?.triggerNuclearClick(nuc.id);
        }, 300);
        break;
      }
      case 'irradiator': {
        const irr = result.data as typeof GAMMA_IRRADIATORS[0];
        this.map?.setView('global');
        this.map?.enableLayer('irradiators');
        this.mapLayers.irradiators = true;
        setTimeout(() => {
          this.map?.triggerIrradiatorClick(irr.id);
        }, 300);
        break;
      }
      case 'earthquake':
      case 'outage':
        // These are dynamic, just switch to map view
        this.map?.setView('global');
        break;
      case 'techcompany': {
        const company = result.data as typeof TECH_COMPANIES[0];
        this.map?.setView('global');
        this.map?.enableLayer('techHQs');
        this.mapLayers.techHQs = true;
        setTimeout(() => {
          this.map?.setCenter(company.lat, company.lon, 4);
        }, 300);
        break;
      }
      case 'ailab': {
        const lab = result.data as typeof AI_RESEARCH_LABS[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.setCenter(lab.lat, lab.lon, 4);
        }, 300);
        break;
      }
      case 'startup': {
        const ecosystem = result.data as typeof STARTUP_ECOSYSTEMS[0];
        this.map?.setView('global');
        this.map?.enableLayer('startupHubs');
        this.mapLayers.startupHubs = true;
        setTimeout(() => {
          this.map?.setCenter(ecosystem.lat, ecosystem.lon, 4);
        }, 300);
        break;
      }
      case 'techevent':
        this.map?.setView('global');
        this.map?.enableLayer('techEvents');
        this.mapLayers.techEvents = true;
        break;
      case 'techhq': {
        const hq = result.data as typeof TECH_HQS[0];
        this.map?.setView('global');
        this.map?.enableLayer('techHQs');
        this.mapLayers.techHQs = true;
        setTimeout(() => {
          this.map?.setCenter(hq.lat, hq.lon, 4);
        }, 300);
        break;
      }
      case 'accelerator': {
        const acc = result.data as typeof ACCELERATORS[0];
        this.map?.setView('global');
        this.map?.enableLayer('accelerators');
        this.mapLayers.accelerators = true;
        setTimeout(() => {
          this.map?.setCenter(acc.lat, acc.lon, 4);
        }, 300);
        break;
      }
      case 'country': {
        const { code, name } = result.data as { code: string; name: string };
        this.openCountryBriefByCode(code, name);
        break;
      }
    }
  }

  private scrollToPanel(panelId: string): void {
    const panel = document.querySelector(`[data-panel="${panelId}"]`);
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.classList.add('flash-highlight');
      setTimeout(() => panel.classList.remove('flash-highlight'), 1500);
    }
  }

  private highlightNewsItem(itemId: string): void {
    setTimeout(() => {
      const item = document.querySelector(`[data-news-id="${itemId}"]`);
      if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        item.classList.add('flash-highlight');
        setTimeout(() => item.classList.remove('flash-highlight'), 1500);
      }
    }, 100);
  }

  private updateSearchIndex(): void {
    if (!this.searchModal) return;

    // Keep country risk labels fresh with latest ingested signals.
    this.searchModal.registerSource('country', this.buildCountrySearchItems());

    // Update news sources (use link as unique id) - index up to 500 items for better search coverage
    const newsItems = this.allNews.slice(0, 500).map(n => ({
      id: n.link,
      title: n.title,
      subtitle: n.source,
      data: n,
    }));
    console.log(`[Search] Indexing ${newsItems.length} news items (allNews total: ${this.allNews.length})`);
    this.searchModal.registerSource('news', newsItems);

    // Update predictions if available
    if (this.latestPredictions.length > 0) {
      this.searchModal.registerSource('prediction', this.latestPredictions.map(p => ({
        id: p.title,
        title: p.title,
        subtitle: `${(p.yesPrice * 100).toFixed(0)}% probability`,
        data: p,
      })));
    }

    // Update markets if available
    if (this.latestMarkets.length > 0) {
      this.searchModal.registerSource('market', this.latestMarkets.map(m => ({
        id: m.symbol,
        title: `${m.symbol} - ${m.name}`,
        subtitle: `$${m.price?.toFixed(2) || 'N/A'}`,
        data: m,
      })));
    }
  }

  private buildCountrySearchItems(): { id: string; title: string; subtitle: string; data: { code: string; name: string } }[] {
    const panelScores = (this.panels['cri'] as CIIPanel | undefined)?.getScores() ?? [];
    const scores = panelScores.length > 0 ? panelScores : calculateRiskScores();
    const riskByCode = new Map(scores.map((score) => [score.code, score]));
    return Object.entries(TIER1_COUNTRIES).map(([code, name]) => {
      const score = riskByCode.get(code);
      return {
        id: code,
        title: `${App.toFlagEmoji(code)} ${name}`,
        subtitle: score ? `Risk: ${score.score}/100 • ${score.level}` : 'Country Brief',
        data: { code, name },
      };
    });
  }

  private static toFlagEmoji(code: string): string {
    const upperCode = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upperCode)) return '🏳️';
    return upperCode
      .split('')
      .map((char) => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65))
      .join('');
  }

  private setupPlaybackControl(): void {
    this.playbackControl = new PlaybackControl();
    this.playbackControl.onSnapshot((snapshot) => {
      if (snapshot) {
        this.isPlaybackMode = true;
        this.restoreSnapshot(snapshot);
      } else {
        this.isPlaybackMode = false;
        this.loadAllData();
      }
    });

    const headerRight = this.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(this.playbackControl.getElement(), headerRight.firstChild);
    }
  }

  private setupSnapshotSaving(): void {
    const saveCurrentSnapshot = async () => {
      if (this.isPlaybackMode || this.isDestroyed) return;

      const marketPrices: Record<string, number> = {};
      this.latestMarkets.forEach(m => {
        if (m.price !== null) marketPrices[m.symbol] = m.price;
      });

      await saveSnapshot({
        timestamp: Date.now(),
        events: this.latestClusters,
        marketPrices,
        predictions: this.latestPredictions.map(p => ({
          title: p.title,
          yesPrice: p.yesPrice
        })),
        hotspotLevels: this.map?.getHotspotLevels() ?? {}
      });
    };

    saveCurrentSnapshot();
    this.snapshotIntervalId = setInterval(saveCurrentSnapshot, 15 * 60 * 1000);
  }

  private restoreSnapshot(snapshot: import('@/services/storage').DashboardSnapshot): void {
    for (const panel of Object.values(this.newsPanels)) {
      panel.showLoading();
    }

    const events = snapshot.events as ClusteredEvent[];
    this.latestClusters = events;

    const predictions = snapshot.predictions.map((p, i) => ({
      id: `snap-${i}`,
      title: p.title,
      yesPrice: p.yesPrice,
      noPrice: 1 - p.yesPrice,
      volume24h: 0,
      liquidity: 0,
    }));
    this.latestPredictions = predictions;
    (this.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

    this.map?.setHotspotLevels(snapshot.hotspotLevels);
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="header">
        <div class="header-left">
          <a href="https://three.ws" target="_blank" rel="noopener" class="logo-link" aria-label="three.ws HQ"><img src="/favicon.svg" alt="" class="logo" /><span class="logo-wordmark">HQ</span></a><span class="version">v${__APP_VERSION__}</span>
          <a href="https://x.com/trythreews" target="_blank" rel="noopener" class="credit-link">
            <svg class="x-logo" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            <span class="credit-text">@trythreews</span>
          </a>
          <a href="https://github.com/nirholas/three.ws" target="_blank" rel="noopener" class="github-link" title="View on GitHub" aria-label="View source on GitHub">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
          <div class="status-indicator" role="status" aria-label="System is live">
            <span class="status-dot" aria-hidden="true"></span>
            <span>LIVE</span>
          </div>
          <div class="region-selector">
            <select id="regionSelect" class="region-select" aria-label="Select region">
              <option value="global">Global</option>
              <option value="america">Americas</option>
              <option value="mena">MENA</option>
              <option value="eu">Europe</option>
              <option value="asia">Asia</option>
              <option value="latam">Latin America</option>
              <option value="africa">Africa</option>
              <option value="oceania">Oceania</option>
            </select>
          </div>
        </div>
        <div class="header-right">
          <div class="header-filter" id="panelsFilterBar">
            <span class="header-filter-icon">🔍</span>
            <input type="text" class="header-filter-input" id="panelFilterInput" placeholder="Filter panels…" autocomplete="off" />
            <button class="header-filter-clear hidden" id="panelFilterClear" title="Clear filter">×</button>
            <span class="header-filter-count" id="panelFilterCount"></span>
          </div>
          <button class="search-btn" id="searchBtn"><kbd>${navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl+'}K</kbd> Search</button>
          ${this.isDesktopApp ? '' : '<button class="copy-link-btn" id="copyLinkBtn">Copy Link</button>'}
          <span class="time-display" id="timeDisplay">--:--:-- UTC</span>
          ${this.isDesktopApp ? '' : '<button class="fullscreen-btn" id="fullscreenBtn" title="Toggle Fullscreen" aria-label="Toggle fullscreen">⛶</button>'}
          <button class="chart-toggle-btn" id="chartToggleBtn" title="Show/Hide Chart">📈 Chart</button>
          <button class="globe-toggle-btn" id="globeToggleBtn" title="Show/Hide Globe">🌐 Globe</button>
          <button class="templates-btn" id="templatesBtn" title="Dashboard Templates">🎨 LAYOUTS</button>
          <button class="notif-bell-btn" id="notifBellBtn" title="Notifications">🔔<span class="notif-badge" id="notifBadge">0</span></button>
          <button class="settings-btn" id="settingsBtn">⚙ PANELS</button>
          <button class="sources-btn" id="sourcesBtn">📡 SOURCES</button>
        </div>
      </div>
      <div class="main-content">
        <div class="chart-section" id="chartSection">
          <!-- 8-direction resize handles -->
          <div class="cs-resize cs-resize-n" data-resize="n"></div>
          <div class="cs-resize cs-resize-ne" data-resize="ne"></div>
          <div class="cs-resize cs-resize-e" data-resize="e"></div>
          <div class="cs-resize cs-resize-se" data-resize="se"></div>
          <div class="cs-resize cs-resize-s" data-resize="s"></div>
          <div class="cs-resize cs-resize-sw" data-resize="sw"></div>
          <div class="cs-resize cs-resize-w" data-resize="w"></div>
          <div class="cs-resize cs-resize-nw" data-resize="nw"></div>
          <!-- Control buttons -->
          <div class="chart-controls" id="chartControls">
            <button class="chart-ctrl-btn" id="chartMoveBtn" title="Drag to move" aria-label="Move chart">⠿</button>
            <button class="chart-ctrl-btn" id="chartCanvasBtn" title="Clear canvas - drag widgets here" aria-label="Clear canvas">🧹</button>
            <button class="chart-ctrl-btn" id="chartPinBtn" title="Pin chart to top" aria-label="Pin chart">📌</button>
            <button class="chart-ctrl-btn" id="chartHideBtn" title="Hide chart" aria-label="Hide chart">✕</button>
          </div>
          <div class="chart-container" id="chartContainer"></div>
          <div class="globe-container" id="globeContainer"></div>
          <div class="chart-sidebar" id="chartSidebar"></div>
          <div class="chart-canvas-grid" id="chartCanvasGrid">
            <div class="canvas-empty-state">
              <span class="canvas-empty-icon">📦</span>
              <span class="canvas-empty-text">Drag panels here to build your layout</span>
            </div>
          </div>
          <div class="chart-drop-zone" id="chartDropZone">
            <span>Drop panel here to dock beside chart</span>
          </div>
        </div>
        <div class="panels-grid" id="panelsGrid"></div>
        <div class="panel-addback-fab" id="panelAddbackFab" title="Add hidden panels back">+</div>
        <div class="panel-addback-popover" id="panelAddbackPopover">
          <div class="panel-addback-header">Hidden Panels</div>
          <div class="panel-addback-list" id="panelAddbackList"></div>
        </div>
      </div>
      <div class="modal-overlay" id="settingsModal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">Panel Settings</span>
            <button class="modal-close" id="modalClose">×</button>
          </div>
          <div class="panel-toggle-grid" id="panelToggles"></div>
        </div>
      </div>
      <div class="modal-overlay" id="sourcesModal">
        <div class="modal sources-modal">
          <div class="modal-header">
            <span class="modal-title">News Sources</span>
            <span class="sources-counter" id="sourcesCounter"></span>
            <button class="modal-close" id="sourcesModalClose">×</button>
          </div>
          <div class="sources-search">
            <input type="text" id="sourcesSearch" placeholder="Filter sources..." />
          </div>
          <div class="sources-toggle-grid" id="sourceToggles"></div>
          <div class="sources-footer">
            <button class="sources-select-all" id="sourcesSelectAll">Select All</button>
            <button class="sources-select-none" id="sourcesSelectNone">Select None</button>
          </div>
        </div>
      </div>
      <div class="modal-overlay" id="templatesModal">
        <div class="modal templates-modal">
          <div class="modal-header">
            <span class="modal-title">Dashboard Layouts</span>
            <button class="modal-close" id="templatesModalClose">×</button>
          </div>
          <div class="templates-grid" id="templatesGrid"></div>
          <div class="templates-footer">
            <button class="templates-save-btn" id="templatesSaveBtn">💾 Save Current as Template</button>
          </div>
        </div>
      </div>
    `;

    this.createPanels();
    this.renderPanelToggles();
    this.setupAddbackFab();
    this.updateTime();
    this.timeIntervalId = setInterval(() => this.updateTime(), 1000);
  }

  /**
   * Render critical posture banner when buildup detected
   */
  private renderCriticalBanner(postures: TheaterPostureSummary[]): void {
    // Check if banner was dismissed this session
    const dismissedAt = sessionStorage.getItem('banner-dismissed');
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
      return; // Stay dismissed for 30 minutes
    }

    const critical = postures.filter(
      (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
    );

    if (critical.length === 0) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
        document.body.classList.remove('has-critical-banner');
      }
      return;
    }

    const top = critical[0]!;
    const isCritical = top.postureLevel === 'critical';

    if (!this.criticalBannerEl) {
      this.criticalBannerEl = document.createElement('div');
      this.criticalBannerEl.className = 'critical-sector-banner';
      const header = document.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', this.criticalBannerEl);
    }

    // Always ensure body class is set when showing banner
    document.body.classList.add('has-critical-banner');
    this.criticalBannerEl.className = `critical-sector-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
    this.criticalBannerEl.innerHTML = `
      <div class="banner-content">
        <span class="banner-icon">${isCritical ? '🚨' : '⚠️'}</span>
        <span class="banner-headline">${top.headline}</span>
        <span class="banner-stats">${top.totalAircraft} transactions • ${top.summary}</span>
        ${top.strikeCapable ? '<span class="banner-strike">HIGH RISK</span>' : ''}
      </div>
      <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
      <button class="banner-dismiss">×</button>
    `;

    // Event handlers
    this.criticalBannerEl.querySelector('.banner-view')?.addEventListener('click', () => {
      console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
      // Use typeof check - truthy check would fail for coordinate 0
      if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
        this.map?.setCenter(top.centerLat, top.centerLon, 4);
      } else {
        console.error('[Banner] Missing coordinates for', top.theaterId);
      }
    });

    this.criticalBannerEl.querySelector('.banner-dismiss')?.addEventListener('click', () => {
      this.criticalBannerEl?.classList.add('dismissed');
      document.body.classList.remove('has-critical-banner');
      sessionStorage.setItem('banner-dismissed', Date.now().toString());
    });
  }

  /**
   * Clean up resources (for HMR/testing)
   */
  public destroy(): void {
    this.isDestroyed = true;

    // Clear time display interval
    if (this.timeIntervalId) {
      clearInterval(this.timeIntervalId);
      this.timeIntervalId = null;
    }

    // Clear snapshot saving interval
    if (this.snapshotIntervalId) {
      clearInterval(this.snapshotIntervalId);
      this.snapshotIntervalId = null;
    }

    // Clear all refresh timeouts
    for (const timeoutId of this.refreshTimeoutIds.values()) {
      clearTimeout(timeoutId);
    }
    this.refreshTimeoutIds.clear();

    // Remove global event listeners
    if (this.boundKeydownHandler) {
      document.removeEventListener('keydown', this.boundKeydownHandler);
      this.boundKeydownHandler = null;
    }
    if (this.boundFullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.boundFullscreenHandler);
      this.boundFullscreenHandler = null;
    }
    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }

    // Clean up idle detection
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
    if (this.boundIdleResetHandler) {
      ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
        document.removeEventListener(event, this.boundIdleResetHandler!);
      });
      this.boundIdleResetHandler = null;
    }

    // Clean up postMessage bridge
    hqBridge.destroy();
    if (this.bridgeMarketDebounceId) clearTimeout(this.bridgeMarketDebounceId);
    if (this.bridgeSignalDebounceId) clearTimeout(this.bridgeSignalDebounceId);

    // Clean up map and AIS
    this.map?.destroy();
    this.tvChart?.destroy();
    disconnectAisStream();

    // Clean up lazy panel observer
    this.panelObserver?.disconnect();
    this.panelObserver = null;
    this.lazyFactories.clear();
  }

  private createPanels(): void {
    const panelsGrid = document.getElementById('panelsGrid')!;

    // Initialize TradingView chart in the chart section
    const chartContainer = document.getElementById('chartContainer') as HTMLElement;
    if (chartContainer) {
      this.tvChart = new TradingViewChart(chartContainer);
      // Restore minimized state on chart section element
      if (this.tvChart.isMinimized()) {
        document.getElementById('chartSection')?.classList.add('chart-minimized');
      }
    }

    // Initialize map in the globe container (hidden by default)
    const globeContainer = document.getElementById('globeContainer')!;
    this.map = new MapContainer(globeContainer, {
      zoom: this.isMobile ? 2.5 : 1.0,
      pan: { x: 0, y: 0 },
      view: this.isMobile ? 'mena' : 'global',
      layers: this.mapLayers,
      timeRange: '7d',
    });

    // Initialize escalation service with data getters
    this.map.initEscalationGetters();

    // Create all panels
    const politicsPanel = new NewsPanel('politics', 'World / Crypto Markets');
    this.attachRelatedAssetHandlers(politicsPanel);
    this.newsPanels['politics'] = politicsPanel;
    this.panels['politics'] = politicsPanel;

    const techPanel = new NewsPanel('tech', 'Technology / AI');
    this.attachRelatedAssetHandlers(techPanel);
    this.newsPanels['tech'] = techPanel;
    this.panels['tech'] = techPanel;

    const financePanel = new NewsPanel('finance', 'Financial News');
    this.attachRelatedAssetHandlers(financePanel);
    this.newsPanels['finance'] = financePanel;
    this.panels['finance'] = financePanel;

    const heatmapPanel = new HeatmapPanel();
    this.panels['heatmap'] = heatmapPanel;

    const marketsPanel = new MarketPanel();
    this.panels['markets'] = marketsPanel;

    const monitorPanel = new MonitorPanel(this.monitors);
    this.panels['monitors'] = monitorPanel;
    monitorPanel.onChanged((monitors) => {
      this.monitors = monitors;
      saveToStorage(STORAGE_KEYS.monitors, monitors);
      this.updateMonitorResults();
    });

    const commoditiesPanel = new CommoditiesPanel();
    this.panels['commodities'] = commoditiesPanel;

    const predictionPanel = new PredictionPanel();
    this.panels['polymarket'] = predictionPanel;

    const govPanel = new NewsPanel('gov', 'Government / Policy');
    this.attachRelatedAssetHandlers(govPanel);
    this.newsPanels['gov'] = govPanel;
    this.panels['gov'] = govPanel;

    const intelPanel = new NewsPanel('intel', 'Intel Feed');
    this.attachRelatedAssetHandlers(intelPanel);
    this.newsPanels['intel'] = intelPanel;
    this.panels['intel'] = intelPanel;

    const cryptoPanel = new CryptoPanel();
    this.panels['crypto'] = cryptoPanel;

    const middleeastPanel = new NewsPanel('middleeast', 'Middle East / MENA');
    this.attachRelatedAssetHandlers(middleeastPanel);
    this.newsPanels['middleeast'] = middleeastPanel;
    this.panels['middleeast'] = middleeastPanel;

    const aiPanel = new NewsPanel('ai', 'AI / ML');
    this.attachRelatedAssetHandlers(aiPanel);
    this.newsPanels['ai'] = aiPanel;
    this.panels['ai'] = aiPanel;

    // Tech variant panels
    const startupsPanel = new NewsPanel('startups', 'Startups & VC');
    this.attachRelatedAssetHandlers(startupsPanel);
    this.newsPanels['startups'] = startupsPanel;
    this.panels['startups'] = startupsPanel;

    const vcblogsPanel = new NewsPanel('vcblogs', 'VC Insights & Essays');
    this.attachRelatedAssetHandlers(vcblogsPanel);
    this.newsPanels['vcblogs'] = vcblogsPanel;
    this.panels['vcblogs'] = vcblogsPanel;

    const regionalStartupsPanel = new NewsPanel('regionalStartups', 'Global Startup News');
    this.attachRelatedAssetHandlers(regionalStartupsPanel);
    this.newsPanels['regionalStartups'] = regionalStartupsPanel;
    this.panels['regionalStartups'] = regionalStartupsPanel;

    const unicornsPanel = new NewsPanel('unicorns', 'Unicorn Tracker');
    this.attachRelatedAssetHandlers(unicornsPanel);
    this.newsPanels['unicorns'] = unicornsPanel;
    this.panels['unicorns'] = unicornsPanel;

    const acceleratorsPanel = new NewsPanel('accelerators', 'Accelerators & Demo Days');
    this.attachRelatedAssetHandlers(acceleratorsPanel);
    this.newsPanels['accelerators'] = acceleratorsPanel;
    this.panels['accelerators'] = acceleratorsPanel;

    const fundingPanel = new NewsPanel('funding', 'Funding & VC');
    this.attachRelatedAssetHandlers(fundingPanel);
    this.newsPanels['funding'] = fundingPanel;
    this.panels['funding'] = fundingPanel;

    const producthuntPanel = new NewsPanel('producthunt', 'Product Hunt');
    this.attachRelatedAssetHandlers(producthuntPanel);
    this.newsPanels['producthunt'] = producthuntPanel;
    this.panels['producthunt'] = producthuntPanel;

    const securityPanel = new NewsPanel('security', 'Cybersecurity');
    this.attachRelatedAssetHandlers(securityPanel);
    this.newsPanels['security'] = securityPanel;
    this.panels['security'] = securityPanel;

    const policyPanel = new NewsPanel('policy', 'AI Policy & Regulation');
    this.attachRelatedAssetHandlers(policyPanel);
    this.newsPanels['policy'] = policyPanel;
    this.panels['policy'] = policyPanel;

    const hardwarePanel = new NewsPanel('hardware', 'Semiconductors & Hardware');
    this.attachRelatedAssetHandlers(hardwarePanel);
    this.newsPanels['hardware'] = hardwarePanel;
    this.panels['hardware'] = hardwarePanel;

    const cloudPanel = new NewsPanel('cloud', 'Cloud & Infrastructure');
    this.attachRelatedAssetHandlers(cloudPanel);
    this.newsPanels['cloud'] = cloudPanel;
    this.panels['cloud'] = cloudPanel;

    const devPanel = new NewsPanel('dev', 'Developer Community');
    this.attachRelatedAssetHandlers(devPanel);
    this.newsPanels['dev'] = devPanel;
    this.panels['dev'] = devPanel;

    const githubPanel = new NewsPanel('github', 'GitHub Trending');
    this.attachRelatedAssetHandlers(githubPanel);
    this.newsPanels['github'] = githubPanel;
    this.panels['github'] = githubPanel;

    const ipoPanel = new NewsPanel('ipo', 'IPO & SPAC');
    this.attachRelatedAssetHandlers(ipoPanel);
    this.newsPanels['ipo'] = ipoPanel;
    this.panels['ipo'] = ipoPanel;

    const thinktanksPanel = new NewsPanel('thinktanks', 'Think Tanks');
    this.attachRelatedAssetHandlers(thinktanksPanel);
    this.newsPanels['thinktanks'] = thinktanksPanel;
    this.panels['thinktanks'] = thinktanksPanel;

    // New Regional Panels
    const africaPanel = new NewsPanel('africa', 'Africa');
    this.attachRelatedAssetHandlers(africaPanel);
    this.newsPanels['africa'] = africaPanel;
    this.panels['africa'] = africaPanel;

    const latamPanel = new NewsPanel('latam', 'Latin America');
    this.attachRelatedAssetHandlers(latamPanel);
    this.newsPanels['latam'] = latamPanel;
    this.panels['latam'] = latamPanel;

    const asiaPanel = new NewsPanel('asia', 'Asia-Pacific');
    this.attachRelatedAssetHandlers(asiaPanel);
    this.newsPanels['asia'] = asiaPanel;
    this.panels['asia'] = asiaPanel;

    const energyPanel = new NewsPanel('energy', 'Energy & Resources');
    this.attachRelatedAssetHandlers(energyPanel);
    this.newsPanels['energy'] = energyPanel;
    this.panels['energy'] = energyPanel;

    // DeFi-only panels (not needed for tech variant)
    if (SITE_VARIANT === 'full') {
      const gdeltIntelPanel = new GdeltIntelPanel();
      this.panels['news-insights'] = gdeltIntelPanel;

      const ciiPanel = new CIIPanel();
      ciiPanel.setShareStoryHandler((code, name) => {
        this.openCountryStory(code, name);
      });
      this.panels['cri'] = ciiPanel;

      const cascadePanel = new CascadePanel();
      this.panels['impact'] = cascadePanel;

      const satelliteFiresPanel = new SatelliteFiresPanel();
      this.panels['satellite-fires'] = satelliteFiresPanel;

      const strategicRiskPanel = new StrategicRiskPanel();
      strategicRiskPanel.setLocationClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['market-risk'] = strategicRiskPanel;

      const strategicPosturePanel = new StrategicPosturePanel();
      strategicPosturePanel.setLocationClickHandler((lat, lon) => {
        console.log('[App] StrategicPosture handler called:', { lat, lon, hasMap: !!this.map });
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['sector-overview'] = strategicPosturePanel;

      const ucdpEventsPanel = new UcdpEventsPanel();
      ucdpEventsPanel.setEventClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 5);
      });
      this.panels['geo-events'] = ucdpEventsPanel;

      const displacementPanel = new DisplacementPanel();
      displacementPanel.setCountryClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['flow-tracker'] = displacementPanel;

      const climatePanel = new ClimateAnomalyPanel();
      climatePanel.setZoneClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['climate'] = climatePanel;

      const populationExposurePanel = new PopulationExposurePanel();
      this.panels['population-exposure'] = populationExposurePanel;
    }

    const liveNewsPanel = new LiveNewsPanel();
    this.panels['live-news'] = liveNewsPanel;

    // --- Lazy-loaded panels (IntersectionObserver triggers dynamic import) ---
    this.panelObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        const key = el.dataset.lazyPanel;
        if (!key) continue;
        this.panelObserver!.unobserve(el);
        const factory = this.lazyFactories.get(key);
        if (!factory) continue;
        this.lazyFactories.delete(key);
        el.classList.add('panel-loading');
        factory().then(panel => {
          if (this.isDestroyed) { panel.destroy(); return; }
          this.panels[key] = panel;
          const newEl = panel.getElement();
          this.makeDraggable(newEl, key);
          el.replaceWith(newEl);
          const cfg = this.panelSettings[key];
          if (cfg && !cfg.enabled) panel.toggle(false);
        }).catch(() => {
          if (this.isDestroyed) return;
          el.classList.remove('panel-loading');
          el.classList.add('panel-lazy-error');
          const content = el.querySelector('.panel-content');
          if (content) content.innerHTML = '<div class="panel-error-msg">Failed to load - <button class="retry-lazy-btn">Retry</button></div>';
          const retryBtn = el.querySelector('.retry-lazy-btn');
          retryBtn?.addEventListener('click', () => {
            el.classList.remove('panel-lazy-error');
            el.classList.add('panel-loading');
            const content2 = el.querySelector('.panel-content');
            if (content2) content2.innerHTML = '<div class="panel-skeleton"><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></div>';
            // Re-register factory and re-observe for retry
            this.lazyFactories.set(key, factory);
            this.panelObserver?.observe(el);
          });
        });
      }
    }, { rootMargin: '300px' });

    // Tech Events Panel
    this.lazyFactories.set('events', async () => {
      const { TechEventsPanel } = await import('@/components/TechEventsPanel');
      return new TechEventsPanel('events');
    });

    // Service Status Panel
    this.lazyFactories.set('service-status', async () => {
      const { ServiceStatusPanel } = await import('@/components/ServiceStatusPanel');
      return new ServiceStatusPanel();
    });

    if (this.isDesktopApp) {
      const runtimeConfigPanel = new RuntimeConfigPanel({ mode: 'alert' });
      this.panels['runtime-config'] = runtimeConfigPanel;
    }

    // Tech Readiness Panel
    this.lazyFactories.set('tech-readiness', async () => {
      const { TechReadinessPanel: TRP } = await import('@/components/TechReadinessPanel');
      const p = new TRP();
      void p.refresh(); // Self-fetch on lazy load (no external caller)
      return p;
    });

    // Crypto & Market Intelligence Panels
    this.lazyFactories.set('macro-signals', async () => {
      const { MacroSignalsPanel } = await import('@/components/MacroSignalsPanel');
      return new MacroSignalsPanel();
    });
    this.lazyFactories.set('etf-flows', async () => {
      const { ETFFlowsPanel } = await import('@/components/ETFFlowsPanel');
      return new ETFFlowsPanel();
    });
    this.lazyFactories.set('stablecoins', async () => {
      const { StablecoinPanel } = await import('@/components/StablecoinPanel');
      return new StablecoinPanel();
    });

    // DeFi Command Center Panels
    this.lazyFactories.set('defi-yields', async () => {
      const { DefiYieldsPanel } = await import('@/components/DefiYieldsPanel');
      return new DefiYieldsPanel();
    });
    this.lazyFactories.set('lending-rates', async () => {
      const { LendingRatesPanel } = await import('@/components/LendingRatesPanel');
      return new LendingRatesPanel();
    });
    this.lazyFactories.set('protocol-revenue', async () => {
      const { ProtocolRevenuePanel } = await import('@/components/ProtocolRevenuePanel');
      return new ProtocolRevenuePanel();
    });
    this.lazyFactories.set('chain-tvl', async () => {
      const { ChainTvlPanel } = await import('@/components/ChainTvlPanel');
      return new ChainTvlPanel();
    });
    this.lazyFactories.set('on-chain', async () => {
      const { OnChainPanel } = await import('@/components/OnChainPanel');
      return new OnChainPanel();
    });
    this.lazyFactories.set('funding-rates', async () => {
      const { FundingRatesPanel } = await import('@/components/FundingRatesPanel');
      return new FundingRatesPanel();
    });
    this.lazyFactories.set('gas-tracker', async () => {
      const { GasTrackerPanel } = await import('@/components/GasTrackerPanel');
      return new GasTrackerPanel();
    });
    this.lazyFactories.set('fee-compare', async () => {
      const { FeeComparePanel } = await import('@/components/FeeComparePanel');
      return new FeeComparePanel();
    });
    this.lazyFactories.set('protocol-health', async () => {
      const { ProtocolHealthPanel } = await import('@/components/ProtocolHealthPanel');
      return new ProtocolHealthPanel();
    });
    this.lazyFactories.set('btc-network', async () => {
      const { BtcNetworkPanel } = await import('@/components/BtcNetworkPanel');
      return new BtcNetworkPanel();
    });
    this.lazyFactories.set('exploit-ledger', async () => {
      const { ExploitLedgerPanel } = await import('@/components/ExploitLedgerPanel');
      return new ExploitLedgerPanel();
    });
    this.lazyFactories.set('sector-rotation', async () => {
      const { SectorRotationPanel } = await import('@/components/SectorRotationPanel');
      return new SectorRotationPanel();
    });
    this.lazyFactories.set('venue-spread', async () => {
      const { VenueSpreadPanel } = await import('@/components/VenueSpreadPanel');
      return new VenueSpreadPanel();
    });
    this.lazyFactories.set('defi-news', async () => {
      const { DefiNewsPanel } = await import('@/components/DefiNewsPanel');
      return new DefiNewsPanel();
    });
    this.lazyFactories.set('defi-protocol-news', async () => {
      const { DefiProtocolNewsPanel } = await import('@/components/DefiNewsPanel');
      return new DefiProtocolNewsPanel();
    });
    this.lazyFactories.set('crypto-research', async () => {
      const { CryptoResearchPanel } = await import('@/components/DefiNewsPanel');
      return new CryptoResearchPanel();
    });
    this.lazyFactories.set('crypto-security', async () => {
      const { CryptoSecurityPanel } = await import('@/components/DefiNewsPanel');
      return new CryptoSecurityPanel();
    });
    this.lazyFactories.set('l1l2-news', async () => {
      const { L1L2NewsPanel } = await import('@/components/DefiNewsPanel');
      return new L1L2NewsPanel();
    });
    this.lazyFactories.set('institutional-crypto', async () => {
      const { InstitutionalCryptoPanel } = await import('@/components/DefiNewsPanel');
      return new InstitutionalCryptoPanel();
    });
    this.lazyFactories.set('bitcoin-news', async () => {
      const { BitcoinNewsPanel } = await import('@/components/DefiNewsPanel');
      return new BitcoinNewsPanel();
    });
    this.lazyFactories.set('ethereum-news', async () => {
      const { EthereumNewsPanel } = await import('@/components/DefiNewsPanel');
      return new EthereumNewsPanel();
    });
    this.lazyFactories.set('solana-news', async () => {
      const { SolanaNewsPanel } = await import('@/components/DefiNewsPanel');
      return new SolanaNewsPanel();
    });
    this.lazyFactories.set('crypto-dev', async () => {
      const { CryptoDevPanel } = await import('@/components/DefiNewsPanel');
      return new CryptoDevPanel();
    });
    this.lazyFactories.set('hack-alerts', async () => {
      const { HackAlertsPanel } = await import('@/components/HackAlertsPanel');
      return new HackAlertsPanel();
    });

    // Governance & DAO Tracker
    this.lazyFactories.set('governance', async () => {
      const { GovernancePanel } = await import('@/components/GovernancePanel');
      return new GovernancePanel();
    });

    // Perps & DEX Trading Panels
    this.lazyFactories.set('dex-trending', async () => {
      const { DexTrendingPanel } = await import('@/components/DexTrendingPanel');
      return new DexTrendingPanel();
    });
    this.lazyFactories.set('open-interest', async () => {
      const { OpenInterestPanel } = await import('@/components/OpenInterestPanel');
      return new OpenInterestPanel();
    });
    this.lazyFactories.set('liquidations', async () => {
      const { LiquidationPanel } = await import('@/components/LiquidationPanel');
      return new LiquidationPanel();
    });
    this.lazyFactories.set('long-short', async () => {
      const { LongShortPanel } = await import('@/components/LongShortPanel');
      return new LongShortPanel();
    });
    this.lazyFactories.set('dex-volume', async () => {
      const { DexVolumePanel } = await import('@/components/DexVolumePanel');
      return new DexVolumePanel();
    });
    this.lazyFactories.set('exchange-flow', async () => {
      const { ExchangeFlowPanel } = await import('@/components/ExchangeFlowPanel');
      return new ExchangeFlowPanel();
    });
    this.lazyFactories.set('mev-monitor', async () => {
      const { MevMonitorPanel } = await import('@/components/MevMonitorPanel');
      return new MevMonitorPanel();
    });
    this.lazyFactories.set('bridge-monitor', async () => {
      const { BridgeMonitorPanel } = await import('@/components/BridgeMonitorPanel');
      return new BridgeMonitorPanel();
    });
    this.lazyFactories.set('token-unlocks', async () => {
      const { TokenUnlocksPanel } = await import('@/components/TokenUnlocksPanel');
      return new TokenUnlocksPanel();
    });

    // --- Prompt 2: Scanner, Sentiment & Tools widgets ---
    this.lazyFactories.set('defi-scanner', async () => {
      const { DeFiScannerPanel } = await import('@/components/DeFiScannerPanel');
      return new DeFiScannerPanel();
    });
    this.lazyFactories.set('social-sentiment', async () => {
      const { SocialSentimentPanel } = await import('@/components/SocialSentimentPanel');
      return new SocialSentimentPanel();
    });
    this.lazyFactories.set('airdrop-tracker', async () => {
      const { AirdropTrackerPanel } = await import('@/components/AirdropTrackerPanel');
      return new AirdropTrackerPanel();
    });
    this.lazyFactories.set('weather', async () => {
      const { WeatherPanel } = await import('@/components/WeatherPanel');
      return new WeatherPanel();
    });
    this.lazyFactories.set('calculator', async () => {
      const { CalculatorPanel } = await import('@/components/CalculatorPanel');
      return new CalculatorPanel();
    });

    // --- Prompt 4: DeFi Markets widgets ---
    this.lazyFactories.set('global-stats', async () => {
      const { GlobalStatsPanel } = await import('@/components/GlobalStatsPanel');
      return new GlobalStatsPanel();
    });
    this.lazyFactories.set('top-protocols', async () => {
      const { TopProtocolsPanel } = await import('@/components/TopProtocolsPanel');
      return new TopProtocolsPanel();
    });
    this.lazyFactories.set('category-breakdown', async () => {
      const { CategoryBreakdownPanel } = await import('@/components/CategoryBreakdownPanel');
      return new CategoryBreakdownPanel();
    });
    this.lazyFactories.set('revenue-earners', async () => {
      const { RevenueEarnersPanel } = await import('@/components/RevenueEarnersPanel');
      return new RevenueEarnersPanel();
    });
    this.lazyFactories.set('stablecoin-dashboard', async () => {
      const { StablecoinDashboardPanel } = await import('@/components/StablecoinDashboardPanel');
      return new StablecoinDashboardPanel();
    });

    // --- Prompt 1: Analytics & Price widgets ---
    this.lazyFactories.set('fear-greed', async () => {
      const { FearGreedPanel } = await import('@/components/FearGreedPanel');
      return new FearGreedPanel();
    });
    this.lazyFactories.set('market-movers', async () => {
      const { MarketMoversPanel } = await import('@/components/MarketMoversPanel');
      return new MarketMoversPanel();
    });
    this.lazyFactories.set('token-ticker', async () => {
      const { TokenTickerPanel } = await import('@/components/TokenTickerPanel');
      return new TokenTickerPanel();
    });
    this.lazyFactories.set('trending-tokens', async () => {
      const { TrendingTokensPanel } = await import('@/components/TrendingTokensPanel');
      return new TrendingTokensPanel();
    });
    this.lazyFactories.set('morning-briefing', async () => {
      const { MorningBriefingPanel } = await import('@/components/MorningBriefingPanel');
      return new MorningBriefingPanel();
    });

    // Wallet Tracker Panel
    this.lazyFactories.set('wallet-tracker', async () => {
      const { WalletTrackerPanel } = await import('@/components/WalletTrackerPanel');
      return new WalletTrackerPanel();
    });

    // Whale Monitor Panel
    this.lazyFactories.set('whale-monitor', async () => {
      const { WhaleMonitorPanel } = await import('@/components/WhaleMonitorPanel');
      return new WhaleMonitorPanel();
    });

    // Notepad Panel
    this.lazyFactories.set('notepad', async () => {
      const { NotepadPanel } = await import('@/components/NotepadPanel');
      return new NotepadPanel();
    });

    // --- Prompt 3: Productivity & Tools widgets ---
    this.lazyFactories.set('notes', async () => {
      const { NotesPanel } = await import('@/components/NotesPanel');
      return new NotesPanel();
    });
    this.lazyFactories.set('calendar', async () => {
      const { CalendarPanel } = await import('@/components/CalendarPanel');
      return new CalendarPanel();
    });
    this.lazyFactories.set('reminders', async () => {
      const { RemindersPanel } = await import('@/components/RemindersPanel');
      return new RemindersPanel();
    });
    this.lazyFactories.set('alarm', async () => {
      const { AlarmPanel } = await import('@/components/AlarmPanel');
      return new AlarmPanel();
    });
    this.lazyFactories.set('activity-streak', async () => {
      const { ActivityStreakPanel } = await import('@/components/ActivityStreakPanel');
      return new ActivityStreakPanel();
    });

    // --- Prompt 5: Gallery, DNA, Yields & Alerts widgets ---
    this.lazyFactories.set('photo-gallery', async () => {
      const { PhotoGalleryPanel } = await import('@/components/PhotoGalleryPanel');
      return new PhotoGalleryPanel();
    });
    this.lazyFactories.set('portfolio-dna', async () => {
      const { PortfolioDNAPanel } = await import('@/components/PortfolioDNAPanel');
      return new PortfolioDNAPanel();
    });
    this.lazyFactories.set('top-yields', async () => {
      const { TopYieldsPanel } = await import('@/components/TopYieldsPanel');
      return new TopYieldsPanel();
    });
    this.lazyFactories.set('compare-protocols', async () => {
      const { CompareProtocolsPanel } = await import('@/components/CompareProtocolsPanel');
      return new CompareProtocolsPanel();
    });
    this.lazyFactories.set('price-alerts', async () => {
      const { PriceAlertsPanel } = await import('@/components/PriceAlertsPanel');
      return new PriceAlertsPanel();
    });

    // --- Crypto News & $THREE signal ---
    this.lazyFactories.set('crypto-news-feed', async () => {
      const { CryptoNewsPanel } = await import('@/components/CryptoNewsPanel');
      return new CryptoNewsPanel();
    });
    this.lazyFactories.set('chain-activity', async () => {
      const { ChainActivityPanel } = await import('@/components/ChainActivityPanel');
      return new ChainActivityPanel();
    });
    this.lazyFactories.set('crypto-trending', async () => {
      const { CryptoTrendingPanel } = await import('@/components/CryptoTrendingPanel');
      return new CryptoTrendingPanel();
    });
    this.lazyFactories.set('three-signal', async () => {
      const { ThreeSignalPanel } = await import('@/components/ThreeSignalPanel');
      return new ThreeSignalPanel();
    });

    // AI Insights Panel (desktop only - hides itself on mobile)
    const insightsPanel = new InsightsPanel();
    this.panels['insights'] = insightsPanel;

    // Add panels to grid in saved order
    // Use DEFAULT_PANELS keys for variant-aware panel order
    const defaultOrder = Object.keys(DEFAULT_PANELS).filter(k => k !== 'map');
    const savedOrder = this.getSavedPanelOrder();
    // Merge saved order with default to include new panels
    let panelOrder = defaultOrder;
    if (savedOrder.length > 0) {
      // Add any missing panels from default that aren't in saved order
      const missing = defaultOrder.filter(k => !savedOrder.includes(k));
      // Remove any saved panels that no longer exist
      const valid = savedOrder.filter(k => defaultOrder.includes(k));
      // Insert missing panels after 'politics' (except monitors which goes at end)
      const monitorsIdx = valid.indexOf('monitors');
      if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1); // Remove monitors temporarily
      const insertIdx = valid.indexOf('politics') + 1 || 0;
      const newPanels = missing.filter(k => k !== 'monitors');
      valid.splice(insertIdx, 0, ...newPanels);
      valid.push('monitors'); // Always put monitors last
      panelOrder = valid;
    }

    // CRITICAL: live-news MUST be first for CSS Grid layout (spans 2 columns)
    // Move it to position 0 if it exists and isn't already first
    const liveNewsIdx = panelOrder.indexOf('live-news');
    if (liveNewsIdx > 0) {
      panelOrder.splice(liveNewsIdx, 1);
      panelOrder.unshift('live-news');
    }

    // Desktop configuration should stay easy to reach in Tauri builds.
    if (this.isDesktopApp) {
      const runtimeIdx = panelOrder.indexOf('runtime-config');
      if (runtimeIdx > 1) {
        panelOrder.splice(runtimeIdx, 1);
        panelOrder.splice(1, 0, 'runtime-config');
      } else if (runtimeIdx === -1) {
        panelOrder.splice(1, 0, 'runtime-config');
      }
    }

    panelOrder.forEach((key: string) => {
      const panel = this.panels[key];
      if (panel) {
        const el = panel.getElement();
        this.makeDraggable(el, key);
        panelsGrid.appendChild(el);
      } else if (this.lazyFactories.has(key)) {
        const config = DEFAULT_PANELS[key];
        const placeholder = document.createElement('div');
        placeholder.className = 'panel panel-lazy';
        placeholder.dataset.panel = key;
        placeholder.dataset.lazyPanel = key;
        placeholder.innerHTML = `<div class="panel-header"><span class="panel-title">${config?.name || key}</span></div><div class="panel-content"><div class="panel-skeleton"><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></div></div>`;
        this.makeDraggable(placeholder, key);
        panelsGrid.appendChild(placeholder);
        this.panelObserver!.observe(placeholder);
      }
    });

    this.applyPanelSettings();
    this.applyInitialUrlState();

  }

  private applyInitialUrlState(): void {
    if (!this.initialUrlState || !this.map) return;

    const { view, zoom, lat, lon, timeRange, layers } = this.initialUrlState;

    if (view) {
      this.map.setView(view);
    }

    if (timeRange) {
      this.map.setTimeRange(timeRange);
    }

    if (layers) {
      this.mapLayers = layers;
      saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
      this.map.setLayers(layers);
    }

    // Only apply custom lat/lon/zoom if NO view preset is specified
    // When a view is specified (eu, mena, etc.), use the preset's positioning
    if (!view) {
      if (zoom !== undefined) {
        this.map.setZoom(zoom);
      }

      // Only apply lat/lon if user has zoomed in significantly (zoom > 2)
      // At default zoom (~1-1.5), show centered global view to avoid clipping issues
      if (lat !== undefined && lon !== undefined && zoom !== undefined && zoom > 2) {
        this.map.setCenter(lat, lon);
      }
    }

    // Sync header region selector with initial view
    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    const currentView = this.map.getState().view;
    if (regionSelect && currentView) {
      regionSelect.value = currentView;
    }
  }

  private getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.PANEL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  private savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const order = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);
    localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(order));
  }

  private attachRelatedAssetHandlers(panel: NewsPanel): void {
    panel.setRelatedAssetHandlers({
      onRelatedAssetClick: (asset) => this.handleRelatedAssetClick(asset),
      onRelatedAssetsFocus: (assets) => this.map?.highlightAssets(assets),
      onRelatedAssetsClear: () => this.map?.highlightAssets(null),
    });
  }

  private handleRelatedAssetClick(asset: RelatedAsset): void {
    if (!this.map) return;

    switch (asset.type) {
      case 'pipeline':
        this.map.enableLayer('pipelines');
        this.mapLayers.pipelines = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerPipelineClick(asset.id);
        break;
      case 'cable':
        this.map.enableLayer('cables');
        this.mapLayers.cables = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerCableClick(asset.id);
        break;
      case 'datacenter':
        this.map.enableLayer('datacenters');
        this.mapLayers.datacenters = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerDatacenterClick(asset.id);
        break;
      case 'facility':
        this.map.enableLayer('bases');
        this.mapLayers.bases = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerBaseClick(asset.id);
        break;
      case 'energy':
        this.map.enableLayer('nuclear');
        this.mapLayers.nuclear = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerNuclearClick(asset.id);
        break;
    }
  }

  private makeDraggable(el: HTMLElement, key: string): void {
    el.draggable = true;
    el.dataset.panel = key;

    el.addEventListener('dragstart', (e) => {
      const target = e.target as HTMLElement;
      // Don't start drag if panel is being resized
      if (el.dataset.resizing === 'true') {
        e.preventDefault();
        return;
      }
      // Don't start drag if target is the resize handle
      if (target.classList.contains('panel-resize-handle') || target.closest('.panel-resize-handle')) {
        e.preventDefault();
        return;
      }
      el.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', key);
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      this.savePanelOrder();
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.dragging');
      if (!dragging || dragging === el) return;

      const grid = document.getElementById('panelsGrid');
      if (!grid) return;

      const siblings = Array.from(grid.children).filter((c) => c !== dragging);
      const nextSibling = siblings.find((sibling) => {
        const rect = sibling.getBoundingClientRect();
        return e.clientY < rect.top + rect.height / 2;
      });

      if (nextSibling) {
        grid.insertBefore(dragging, nextSibling);
      } else {
        grid.appendChild(dragging);
      }
    });
  }

  /** Allow panels to be dragged to/from the chart sidebar zone */
  private setupZoneDrag(): void {
    const chartSection = document.getElementById('chartSection');
    const dropZone = document.getElementById('chartDropZone');
    const sidebar = document.getElementById('chartSidebar');
    const panelsGrid = document.getElementById('panelsGrid');
    if (!chartSection || !dropZone || !sidebar || !panelsGrid) return;

    // Show drop zone when dragging over chart section
    chartSection.addEventListener('dragover', (e) => {
      const dragging = document.querySelector('.panel.dragging');
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('visible');
    });

    chartSection.addEventListener('dragleave', (e) => {
      // Only hide if leaving chart section entirely
      if (!chartSection.contains(e.relatedTarget as Node)) {
        dropZone.classList.remove('visible');
      }
    });

    // Drop panel into chart sidebar
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('visible');
      const dragging = document.querySelector('.panel.dragging') as HTMLElement;
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging.classList.add('docked-panel');
      sidebar.appendChild(dragging);
      // Save docked state
      this.saveDockedPanels();
      this.savePanelOrder();
    });

    // Allow docked panels to be dragged back to grid
    sidebar.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    // Allow grid to accept panels back from sidebar
    panelsGrid.addEventListener('drop', (e) => {
      const dragging = document.querySelector('.panel.dragging.docked-panel') as HTMLElement;
      if (!dragging) return;
      e.preventDefault();
      dragging.classList.remove('docked-panel');
      // Find insertion point
      const siblings = Array.from(panelsGrid.children).filter(c => c !== dragging);
      const nextSibling = siblings.find(sibling => {
        const rect = sibling.getBoundingClientRect();
        return e.clientY < rect.top + rect.height / 2;
      });
      if (nextSibling) {
        panelsGrid.insertBefore(dragging, nextSibling);
      } else {
        panelsGrid.appendChild(dragging);
      }
      this.saveDockedPanels();
      this.savePanelOrder();
    });

    // Restore docked panels from localStorage
    this.restoreDockedPanels();
  }

  private saveDockedPanels(): void {
    const sidebar = document.getElementById('chartSidebar');
    if (!sidebar) return;
    const docked = Array.from(sidebar.querySelectorAll('.panel'))
      .map(el => (el as HTMLElement).dataset.panel)
      .filter(Boolean) as string[];
    localStorage.setItem('hq-docked-panels', JSON.stringify(docked));
  }

  private restoreDockedPanels(): void {
    const sidebar = document.getElementById('chartSidebar');
    if (!sidebar) return;
    const saved = localStorage.getItem('hq-docked-panels');
    if (!saved) return;
    try {
      const keys: string[] = JSON.parse(saved);
      const panelsGrid = document.getElementById('panelsGrid');
      if (!panelsGrid) return;
      keys.forEach(key => {
        const el = panelsGrid.querySelector(`[data-panel="${key}"]`) as HTMLElement;
        if (el) {
          el.classList.add('docked-panel');
          sidebar.appendChild(el);
        }
      });
    } catch { /* ignore */ }
  }

  private setupEventListeners(): void {
    // Search button
    document.getElementById('searchBtn')?.addEventListener('click', () => {
      this.updateSearchIndex();
      this.searchModal?.open();
    });

    // Copy link button
    document.getElementById('copyLinkBtn')?.addEventListener('click', async () => {
      const shareUrl = this.getShareUrl();
      if (!shareUrl) return;
      const button = document.getElementById('copyLinkBtn');
      try {
        await this.copyToClipboard(shareUrl);
        this.setCopyLinkFeedback(button, 'Copied!');
      } catch (error) {
        console.warn('Failed to copy share link:', error);
        this.setCopyLinkFeedback(button, 'Copy failed');
      }
    });

    // Settings modal
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      document.getElementById('settingsModal')?.classList.add('active');
    });

    document.getElementById('modalClose')?.addEventListener('click', () => {
      document.getElementById('settingsModal')?.classList.remove('active');
    });

    document.getElementById('settingsModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
        document.getElementById('settingsModal')?.classList.remove('active');
      }
    });

    // Sources modal
    this.setupSourcesModal();

    // Templates modal
    this.setupTemplatesModal();

    // Fullscreen toggle
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (!this.isDesktopApp && fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
      this.boundFullscreenHandler = () => {
        fullscreenBtn.textContent = document.fullscreenElement ? '⛶' : '⛶';
        fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', this.boundFullscreenHandler);
    }

    // Region selector
    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    regionSelect?.addEventListener('change', () => {
      this.map?.setView(regionSelect.value as MapView);
    });

    // Window resize
    this.boundResizeHandler = () => {
      this.map?.render();
    };
    window.addEventListener('resize', this.boundResizeHandler);

    // Chart section: 8-direction resize, pin, hide/show, move
    this.setupChartResize();
    this.setupChartPin();
    this.setupChartHideToggle();
    this.setupGlobeToggle();
    this.setupChartCanvasMode();
    this.setupChartMove();

    // Pause animations when tab is hidden, unload ML models to free memory
    this.boundVisibilityHandler = () => {
      document.body.classList.toggle('animations-paused', document.hidden);
      if (document.hidden) {
        mlWorker.unloadOptionalModels();
      } else {
        this.resetIdleTimer();
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    // Refresh risk scores when focal points are ready (ensures focal point urgency is factored in)
    window.addEventListener('focal-points-ready', () => {
      (this.panels['cri'] as CIIPanel)?.refresh(true); // forceLocal to use focal point data
    });

    // Idle detection - pause animations after 2 minutes of inactivity
    this.setupIdleDetection();
  }

  private setupIdleDetection(): void {
    this.boundIdleResetHandler = () => {
      // User is active - resume animations if we were idle
      if (this.isIdle) {
        this.isIdle = false;
        document.body.classList.remove('animations-paused');
      }
      this.resetIdleTimer();
    };

    // Track user activity
    ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
      document.addEventListener(event, this.boundIdleResetHandler!, { passive: true });
    });

    // Start the idle timer
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
    }
    this.idleTimeoutId = setTimeout(() => {
      if (!document.hidden) {
        this.isIdle = true;
        document.body.classList.add('animations-paused');
        console.log('[App] User idle - pausing animations to save resources');
      }
    }, this.IDLE_PAUSE_MS);
  }

  private setupUrlStateSync(): void {
    if (!this.map) return;
    const update = debounce(() => {
      const shareUrl = this.getShareUrl();
      if (!shareUrl) return;
      history.replaceState(null, '', shareUrl);
    }, 250);

    this.map.onStateChanged(() => {
      update();
      // Sync header region selector with map view
      const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
      if (regionSelect && this.map) {
        const state = this.map.getState();
        if (regionSelect.value !== state.view) {
          regionSelect.value = state.view;
        }
      }
    });
    update();
  }

  private getShareUrl(): string | null {
    if (!this.map) return null;
    const state = this.map.getState();
    const center = this.map.getCenter();
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    return buildMapUrl(baseUrl, {
      view: state.view,
      zoom: state.zoom,
      center,
      timeRange: state.timeRange,
      layers: state.layers,
      country: this.countryBriefPage?.isVisible() ? (this.countryBriefPage.getCode() ?? undefined) : undefined,
    });
  }

  private async copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  private setCopyLinkFeedback(button: HTMLElement | null, message: string): void {
    if (!button) return;
    const originalText = button.textContent ?? '';
    button.textContent = message;
    button.classList.add('copied');
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 1500);
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  private setupChartResize(): void {
    const chartSection = document.getElementById('chartSection');
    if (!chartSection) return;

    // Load saved dimensions
    const savedHeight = localStorage.getItem('chart-height');
    const savedWidth = localStorage.getItem('chart-width');
    if (savedHeight) chartSection.style.height = savedHeight;
    if (savedWidth) chartSection.style.width = savedWidth;

    const handles = chartSection.querySelectorAll<HTMLElement>('.cs-resize');
    if (!handles.length) return;

    type Dir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
    const cursors: Record<Dir, string> = {
      n: 'ns-resize', s: 'ns-resize',
      e: 'ew-resize', w: 'ew-resize',
      ne: 'nesw-resize', sw: 'nesw-resize',
      nw: 'nwse-resize', se: 'nwse-resize',
    };

    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let dir: Dir = 's';

    const onPointerMove = (e: PointerEvent): void => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newW = startW;
      let newH = startH;

      // Horizontal
      if (dir.includes('e')) newW = Math.max(280, startW + dx);
      if (dir.includes('w')) newW = Math.max(280, startW - dx);

      // Vertical
      if (dir.includes('s')) newH = Math.max(200, Math.min(startH + dy, window.innerHeight - 60));
      if (dir.includes('n')) newH = Math.max(200, Math.min(startH - dy, window.innerHeight - 60));

      chartSection.style.height = `${newH}px`;
      // Only set width if user is resizing horizontally (not full-width by default)
      if (dir.includes('e') || dir.includes('w')) {
        chartSection.style.width = `${newW}px`;
        chartSection.style.maxWidth = 'none';
      }
    };

    const onPointerUp = (): void => {
      if (!isResizing) return;
      isResizing = false;
      chartSection.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('chart-height', chartSection.style.height);
      if (chartSection.style.width) {
        localStorage.setItem('chart-width', chartSection.style.width);
      }
    };

    handles.forEach(handle => {
      const d = handle.dataset.resize as Dir;
      handle.style.touchAction = 'none';

      handle.addEventListener('pointerdown', (e) => {
        dir = d;
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = chartSection.offsetWidth;
        startH = chartSection.offsetHeight;
        chartSection.classList.add('resizing');
        document.body.style.cursor = cursors[d];
        document.body.style.userSelect = 'none';
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      });

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });

    // Double-click any handle to reset dimensions
    chartSection.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('cs-resize')) {
        chartSection.style.height = '';
        chartSection.style.width = '';
        chartSection.style.maxWidth = '';
        localStorage.removeItem('chart-height');
        localStorage.removeItem('chart-width');
      }
    });
  }

  private setupChartPin(): void {
    const chartSection = document.getElementById('chartSection');
    const pinBtn = document.getElementById('chartPinBtn');
    if (!chartSection || !pinBtn) return;

    const isPinned = localStorage.getItem('chart-pinned') === 'true';
    if (isPinned) {
      chartSection.classList.add('pinned');
      pinBtn.classList.add('active');
    }

    pinBtn.addEventListener('click', () => {
      const nowPinned = chartSection.classList.toggle('pinned');
      pinBtn.classList.toggle('active', nowPinned);
      localStorage.setItem('chart-pinned', String(nowPinned));
    });
  }

  private setupChartHideToggle(): void {
    const chartSection = document.getElementById('chartSection');
    const hideBtn = document.getElementById('chartHideBtn');
    const toggleBtn = document.getElementById('chartToggleBtn');
    if (!chartSection) return;

    // Load saved visibility
    const isHidden = localStorage.getItem('chart-hidden') === 'true';
    if (isHidden) {
      chartSection.classList.add('hidden');
      toggleBtn?.classList.add('chart-hidden-state');
    }

    // Hide button inside chart section
    hideBtn?.addEventListener('click', () => {
      chartSection.classList.add('hidden');
      toggleBtn?.classList.add('chart-hidden-state');
      localStorage.setItem('chart-hidden', 'true');
    });

    // Toggle button in header - show/hide chart
    toggleBtn?.addEventListener('click', () => {
      const nowHidden = chartSection.classList.toggle('hidden');
      toggleBtn.classList.toggle('chart-hidden-state', nowHidden);
      localStorage.setItem('chart-hidden', String(nowHidden));
    });
  }

  private setupGlobeToggle(): void {
    const chartSection = document.getElementById('chartSection');
    const globeContainer = document.getElementById('globeContainer');
    const globeBtn = document.getElementById('globeToggleBtn');
    if (!chartSection || !globeContainer || !globeBtn) return;

    // Restore saved globe visibility
    const isGlobeVisible = localStorage.getItem('globe-visible') === 'true';
    if (isGlobeVisible) {
      chartSection.classList.add('globe-visible');
      globeBtn.classList.add('globe-active-state');
      // Ensure chart section is shown when globe is active
      chartSection.classList.remove('hidden');
      // Trigger map resize after layout settles
      requestAnimationFrame(() => this.map?.render());
    }

    globeBtn.addEventListener('click', () => {
      const nowVisible = chartSection.classList.toggle('globe-visible');
      globeBtn.classList.toggle('globe-active-state', nowVisible);
      localStorage.setItem('globe-visible', String(nowVisible));

      if (nowVisible) {
        // Show chart section if hidden
        chartSection.classList.remove('hidden');
        const chartToggle = document.getElementById('chartToggleBtn');
        chartToggle?.classList.remove('chart-hidden-state');
        localStorage.setItem('chart-hidden', 'false');
        // Trigger map resize after layout change
        requestAnimationFrame(() => this.map?.render());
      }
    });
  }

  private setupChartCanvasMode(): void {
    const chartSection = document.getElementById('chartSection');
    const canvasBtn = document.getElementById('chartCanvasBtn');
    const canvasGrid = document.getElementById('chartCanvasGrid');
    const panelsGrid = document.getElementById('panelsGrid');
    if (!chartSection || !canvasBtn || !canvasGrid || !panelsGrid) return;

    // Restore canvas mode from localStorage
    const wasCanvas = localStorage.getItem('chart-canvas-mode') === 'true';
    if (wasCanvas) {
      chartSection.classList.add('canvas-mode');
      canvasBtn.classList.add('active');
      this.restoreCanvasPanels();
    }

    canvasBtn.addEventListener('click', () => {
      const isCanvas = chartSection.classList.toggle('canvas-mode');
      canvasBtn.classList.toggle('active', isCanvas);
      localStorage.setItem('chart-canvas-mode', String(isCanvas));

      if (!isCanvas) {
        // Exiting canvas mode - move all docked canvas panels back to grid
        const canvasPanels = canvasGrid.querySelectorAll('.panel');
        canvasPanels.forEach(panel => {
          (panel as HTMLElement).classList.remove('canvas-panel');
          panelsGrid.appendChild(panel);
        });
        this.saveCanvasPanels();
        this.savePanelOrder();
      }
    });

    // Canvas grid accepts drag-dropped panels
    canvasGrid.addEventListener('dragover', (e) => {
      const dragging = document.querySelector('.panel.dragging');
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      canvasGrid.classList.add('drag-hover');
    });

    canvasGrid.addEventListener('dragleave', (e) => {
      if (!canvasGrid.contains(e.relatedTarget as Node)) {
        canvasGrid.classList.remove('drag-hover');
      }
    });

    canvasGrid.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      canvasGrid.classList.remove('drag-hover');
      const dragging = document.querySelector('.panel.dragging') as HTMLElement;
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging.classList.add('canvas-panel');

      // Hide empty state if present
      const emptyState = canvasGrid.querySelector('.canvas-empty-state');
      if (emptyState) (emptyState as HTMLElement).style.display = 'none';

      canvasGrid.appendChild(dragging);
      this.saveCanvasPanels();
      this.savePanelOrder();
    });

    // Allow panels to be dragged back from canvas to grid
    panelsGrid.addEventListener('drop', () => {
      const dragging = document.querySelector('.panel.dragging.canvas-panel') as HTMLElement;
      if (!dragging) return;
      // Don't prevent double-handling - the existing grid drop handles this
      dragging.classList.remove('canvas-panel');
      this.saveCanvasPanels();
      // Show empty state if canvas is now empty
      this.updateCanvasEmptyState();
    });
  }

  private saveCanvasPanels(): void {
    const canvasGrid = document.getElementById('chartCanvasGrid');
    if (!canvasGrid) return;
    const panels = Array.from(canvasGrid.querySelectorAll('.panel'))
      .map(el => (el as HTMLElement).dataset.panel)
      .filter(Boolean) as string[];
    localStorage.setItem('canvas-panels', JSON.stringify(panels));
  }

  private restoreCanvasPanels(): void {
    const canvasGrid = document.getElementById('chartCanvasGrid');
    const panelsGrid = document.getElementById('panelsGrid');
    if (!canvasGrid || !panelsGrid) return;

    try {
      const saved = JSON.parse(localStorage.getItem('canvas-panels') || '[]') as string[];
      if (saved.length === 0) return;

      saved.forEach(key => {
        const panelEl = panelsGrid.querySelector(`[data-panel="${key}"]`) as HTMLElement;
        if (panelEl) {
          panelEl.classList.add('canvas-panel');
          canvasGrid.appendChild(panelEl);
        }
      });

      this.updateCanvasEmptyState();
    } catch { /* ignore corrupt data */ }
  }

  private updateCanvasEmptyState(): void {
    const canvasGrid = document.getElementById('chartCanvasGrid');
    if (!canvasGrid) return;
    const emptyState = canvasGrid.querySelector('.canvas-empty-state') as HTMLElement;
    const hasPanels = canvasGrid.querySelectorAll('.panel').length > 0;
    if (emptyState) emptyState.style.display = hasPanels ? 'none' : '';
  }

  private setupChartMove(): void {
    const chartSection = document.getElementById('chartSection');
    const moveBtn = document.getElementById('chartMoveBtn');
    const mainContent = chartSection?.parentElement;
    if (!chartSection || !moveBtn || !mainContent) return;

    let isDragging = false;
    let ghostEl: HTMLElement | null = null;

    moveBtn.style.touchAction = 'none';
    moveBtn.style.cursor = 'grab';

    moveBtn.addEventListener('pointerdown', (e) => {
      isDragging = true;
      moveBtn.style.cursor = 'grabbing';
      moveBtn.setPointerCapture(e.pointerId);
      e.preventDefault();

      // Create visual ghost
      ghostEl = document.createElement('div');
      ghostEl.className = 'chart-move-ghost';
      ghostEl.style.height = `${chartSection.offsetHeight}px`;
      mainContent.insertBefore(ghostEl, chartSection);

      chartSection.classList.add('chart-dragging');
    });

    moveBtn.addEventListener('pointermove', (e) => {
      if (!isDragging) return;

      // Find the sibling to insert before based on pointer Y
      const panelsGrid = document.getElementById('panelsGrid');
      if (!panelsGrid) return;

      const panelsRect = panelsGrid.getBoundingClientRect();

      // Determine if chart should be above or below panels
      if (e.clientY > panelsRect.top + 100) {
        // Move chart below panels grid
        if (chartSection.nextElementSibling !== null && mainContent.lastElementChild !== chartSection) {
          mainContent.appendChild(chartSection);
          if (ghostEl) mainContent.appendChild(ghostEl);
          localStorage.setItem('chart-position', 'bottom');
        }
      } else {
        // Move chart above panels grid
        if (panelsGrid.previousElementSibling !== chartSection) {
          mainContent.insertBefore(chartSection, panelsGrid);
          if (ghostEl) mainContent.insertBefore(ghostEl, chartSection);
          localStorage.setItem('chart-position', 'top');
        }
      }
    });

    const finishDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      moveBtn.style.cursor = 'grab';
      chartSection.classList.remove('chart-dragging');
      ghostEl?.remove();
      ghostEl = null;
    };

    moveBtn.addEventListener('pointerup', finishDrag);
    moveBtn.addEventListener('pointercancel', finishDrag);

    // Restore saved position
    const savedPos = localStorage.getItem('chart-position');
    const panelsGrid = document.getElementById('panelsGrid');
    if (savedPos === 'bottom' && panelsGrid && mainContent) {
      mainContent.appendChild(chartSection);
    }
  }

  private renderPanelToggles(): void {
    const container = document.getElementById('panelToggles')!;
    container.innerHTML = Object.entries(this.panelSettings)
      .filter(([key]) => key !== 'runtime-config' || this.isDesktopApp)
      .map(
        ([key, panel]) => `
        <div class="panel-toggle-item ${panel.enabled ? 'active' : ''}" data-panel="${key}">
          <div class="panel-toggle-checkbox">${panel.enabled ? '✓' : ''}</div>
          <span class="panel-toggle-label">${panel.name}</span>
        </div>
      `
      )
      .join('');

    container.querySelectorAll('.panel-toggle-item').forEach((item) => {
      item.addEventListener('click', () => {
        const panelKey = (item as HTMLElement).dataset.panel!;
        const config = this.panelSettings[panelKey];
        console.log('[Panel Toggle] Clicked:', panelKey, 'Current enabled:', config?.enabled);
        if (config) {
          config.enabled = !config.enabled;
          console.log('[Panel Toggle] New enabled:', config.enabled);
          saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
          this.renderPanelToggles();
          this.applyPanelSettings();
          this.updateAddbackFab();
          hqBridge.emitPanelToggled(panelKey, config.enabled);
          console.log('[Panel Toggle] After apply - config.enabled:', this.panelSettings[panelKey]?.enabled);
        }
      });
    });
  }

  /** Floating "+" button that shows hidden panels for quick re-enable */
  private updateAddbackFab(): void {
    const fab = document.getElementById('panelAddbackFab');
    if (!fab) return;
    const hiddenPanels = Object.entries(this.panelSettings).filter(
      ([key, cfg]) => !cfg.enabled && key !== 'chart' && key !== 'map' && (key !== 'runtime-config' || this.isDesktopApp)
    );
    fab.style.display = hiddenPanels.length > 0 ? '' : 'none';
    fab.textContent = `+ ${hiddenPanels.length}`;
  }

  private setupAddbackFab(): void {
    const fab = document.getElementById('panelAddbackFab');
    const popover = document.getElementById('panelAddbackPopover');
    if (!fab || !popover) return;

    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = popover.classList.toggle('open');
      if (isOpen) this.renderAddbackList();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!popover.contains(e.target as Node) && !fab.contains(e.target as Node)) {
        popover.classList.remove('open');
      }
    });
    this.updateAddbackFab();
  }

  private renderAddbackList(): void {
    const list = document.getElementById('panelAddbackList');
    if (!list) return;
    const hiddenPanels = Object.entries(this.panelSettings).filter(
      ([key, cfg]) => !cfg.enabled && key !== 'chart' && key !== 'map' && (key !== 'runtime-config' || this.isDesktopApp)
    );
    list.innerHTML = hiddenPanels.map(([key, cfg]) =>
      `<button class="panel-addback-item" data-key="${key}">${cfg.name}</button>`
    ).join('') || '<div style="padding:8px;color:var(--text-dim)">All panels visible</div>';

    list.querySelectorAll('.panel-addback-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = (btn as HTMLElement).dataset.key!;
        const config = this.panelSettings[key];
        if (config) {
          config.enabled = true;
          saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
          this.applyPanelSettings();
          this.renderPanelToggles();
          this.renderAddbackList();
          this.updateAddbackFab();
        }
      });
    });
  }

  private getAllSourceNames(): string[] {
    const sources = new Set<string>();
    Object.values(FEEDS).forEach(feeds => {
      if (feeds) feeds.forEach(f => sources.add(f.name));
    });
    RESEARCH_SOURCES.forEach(f => sources.add(f.name));
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }

  private renderSourceToggles(filter = ''): void {
    const container = document.getElementById('sourceToggles')!;
    const allSources = this.getAllSourceNames();
    const filterLower = filter.toLowerCase();
    const filteredSources = filter
      ? allSources.filter(s => s.toLowerCase().includes(filterLower))
      : allSources;

    container.innerHTML = filteredSources.map(source => {
      const isEnabled = !this.disabledSources.has(source);
      const escaped = escapeHtml(source);
      return `
        <div class="source-toggle-item ${isEnabled ? 'active' : ''}" data-source="${escaped}">
          <div class="source-toggle-checkbox">${isEnabled ? '✓' : ''}</div>
          <span class="source-toggle-label">${escaped}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.source-toggle-item').forEach(item => {
      item.addEventListener('click', () => {
        const sourceName = (item as HTMLElement).dataset.source!;
        if (this.disabledSources.has(sourceName)) {
          this.disabledSources.delete(sourceName);
        } else {
          this.disabledSources.add(sourceName);
        }
        saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(this.disabledSources));
        this.renderSourceToggles(filter);
      });
    });

    // Update counter
    const enabledCount = allSources.length - this.disabledSources.size;
    const counterEl = document.getElementById('sourcesCounter');
    if (counterEl) {
      counterEl.textContent = `${enabledCount}/${allSources.length} enabled`;
    }
  }

  private setupSourcesModal(): void {
    document.getElementById('sourcesBtn')?.addEventListener('click', () => {
      document.getElementById('sourcesModal')?.classList.add('active');
      // Clear search and show all sources on open
      const searchInput = document.getElementById('sourcesSearch') as HTMLInputElement | null;
      if (searchInput) searchInput.value = '';
      this.renderSourceToggles();
    });

    document.getElementById('sourcesModalClose')?.addEventListener('click', () => {
      document.getElementById('sourcesModal')?.classList.remove('active');
    });

    document.getElementById('sourcesModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
        document.getElementById('sourcesModal')?.classList.remove('active');
      }
    });

    document.getElementById('sourcesSearch')?.addEventListener('input', (e) => {
      const filter = (e.target as HTMLInputElement).value;
      this.renderSourceToggles(filter);
    });

    document.getElementById('sourcesSelectAll')?.addEventListener('click', () => {
      this.disabledSources.clear();
      saveToStorage(STORAGE_KEYS.disabledFeeds, []);
      const filter = (document.getElementById('sourcesSearch') as HTMLInputElement)?.value || '';
      this.renderSourceToggles(filter);
    });

    document.getElementById('sourcesSelectNone')?.addEventListener('click', () => {
      const allSources = this.getAllSourceNames();
      this.disabledSources = new Set(allSources);
      saveToStorage(STORAGE_KEYS.disabledFeeds, allSources);
      const filter = (document.getElementById('sourcesSearch') as HTMLInputElement)?.value || '';
      this.renderSourceToggles(filter);
    });
  }

  /* ── Dashboard Templates System ────────────────────────────────── */

  private setupTemplatesModal(): void {
    const modal = document.getElementById('templatesModal');
    const btn = document.getElementById('templatesBtn');
    const closeBtn = document.getElementById('templatesModalClose');
    const saveBtn = document.getElementById('templatesSaveBtn');

    btn?.addEventListener('click', () => {
      this.renderTemplatesGrid();
      modal?.classList.add('active');
    });

    closeBtn?.addEventListener('click', () => {
      modal?.classList.remove('active');
    });

    modal?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
        modal.classList.remove('active');
      }
    });

    saveBtn?.addEventListener('click', () => {
      this.saveCurrentAsTemplate();
    });
  }

  private getCustomTemplates(): DashboardTemplate[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.customTemplates);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private saveCustomTemplates(templates: DashboardTemplate[]): void {
    localStorage.setItem(STORAGE_KEYS.customTemplates, JSON.stringify(templates));
  }

  private renderTemplatesGrid(): void {
    const grid = document.getElementById('templatesGrid');
    if (!grid) return;

    const allTemplates = [...BUILTIN_TEMPLATES, ...this.getCustomTemplates()];

    grid.innerHTML = allTemplates.map(t => `
      <div class="template-card" data-template-id="${t.id}">
        <div class="template-card-icon">${t.icon}</div>
        <div class="template-card-info">
          <div class="template-card-name">${escapeHtml(t.name)}</div>
          <div class="template-card-desc">${escapeHtml(t.description)}</div>
        </div>
        ${t.custom ? '<button class="template-delete-btn" data-delete-id="' + t.id + '" title="Delete">🗑</button>' : ''}
      </div>
    `).join('');

    // Click to apply
    grid.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't apply if clicking delete button
        if ((e.target as HTMLElement).classList.contains('template-delete-btn')) return;
        const id = (card as HTMLElement).dataset.templateId!;
        this.applyTemplateById(id);
        document.getElementById('templatesModal')?.classList.remove('active');
      });
    });

    // Delete custom templates
    grid.querySelectorAll('.template-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.deleteId!;
        const customs = this.getCustomTemplates().filter(t => t.id !== id);
        this.saveCustomTemplates(customs);
        this.renderTemplatesGrid();
      });
    });
  }

  private applyTemplateById(id: string): void {
    const allTemplates = [...BUILTIN_TEMPLATES, ...this.getCustomTemplates()];
    const template = allTemplates.find(t => t.id === id);
    if (!template) return;
    this.applyTemplate(template);
    localStorage.setItem(STORAGE_KEYS.activeTemplate, id);
  }

  private applyTemplate(template: DashboardTemplate): void {
    const chartSection = document.getElementById('chartSection');
    const panelsGrid = document.getElementById('panelsGrid');
    if (!panelsGrid) return;

    // Notify parent frame
    hqBridge.emitTemplateChanged(template.id, template.name);

    // 1. Show/hide chart section
    if (chartSection) {
      chartSection.classList.toggle('hidden', !template.chartVisible);
      localStorage.setItem('chart-hidden', String(!template.chartVisible));
      const toggleBtn = document.getElementById('chartToggleBtn');
      toggleBtn?.classList.toggle('chart-hidden-state', !template.chartVisible);
    }

    // 2. Update panel settings
    if (template.panelOrder.length === 0) {
      // "default" template - enable all panels, use default order
      Object.values(this.panelSettings).forEach(cfg => { cfg.enabled = true; });
    } else {
      const enabledSet = new Set(template.panelOrder);
      Object.entries(this.panelSettings).forEach(([key, cfg]) => {
        if (key === 'chart' || key === 'map') {
          cfg.enabled = template.chartVisible;
        } else {
          cfg.enabled = enabledSet.has(key);
        }
      });
    }

    // 3. Handle TradingView widget panels in the grid
    // First, remove any existing TV widget panels from the grid
    panelsGrid.querySelectorAll('[data-panel^="tv-widget-"]').forEach(el => {
      const key = (el as HTMLElement).dataset.panel!;
      const panel = this.panels[key];
      if (panel) {
        panel.destroy();
        delete this.panels[key];
      }
      el.remove();
    });

    // Create new TV widget panels if template has them
    if (template.tvWidgetSlots) {
      template.tvWidgetSlots.forEach((slot, i) => {
        const instanceId = `t${i + 1}`;
        const key = `tv-widget-${instanceId}`;
        const tvWidget = new TradingViewWidgetPanel(instanceId, slot.symbol, slot.interval);
        this.panels[key] = tvWidget;
        const el = tvWidget.getElement();
        this.makeDraggable(el, key);
        // Add panel settings entry
        this.panelSettings[key] = { name: `Chart ${slot.symbol.split(':').pop() || ''}`, enabled: true, priority: 2 };
      });
    }

    // 4. Reorder panels in the DOM
    if (template.panelOrder.length > 0) {
      // Add TV widget keys at their positions
      const fullOrder = [...template.panelOrder];

      fullOrder.forEach(key => {
        const panel = this.panels[key];
        if (panel) {
          panelsGrid.appendChild(panel.getElement());
        } else {
          // Check for lazy placeholders
          const placeholder = panelsGrid.querySelector(`[data-panel="${key}"]`) as HTMLElement;
          if (placeholder) panelsGrid.appendChild(placeholder);
        }
      });

      // Move remaining panels (not in template) to end, hidden
      const allChildren = Array.from(panelsGrid.children) as HTMLElement[];
      const orderedKeys = new Set(fullOrder);
      allChildren.forEach(el => {
        const pk = el.dataset.panel || el.dataset.lazyPanel;
        if (pk && !orderedKeys.has(pk)) {
          panelsGrid.appendChild(el);
        }
      });

      // Save new order
      localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(fullOrder));
    }

    // 5. Save and apply
    saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
    this.applyPanelSettings();
    this.renderPanelToggles();
    this.updateAddbackFab();

    // 6. Clear panel filter when template changes
    const filterInput = document.getElementById('panelFilterInput') as HTMLInputElement | null;
    if (filterInput && filterInput.value) {
      filterInput.value = '';
      filterInput.dispatchEvent(new Event('input'));
    }
  }

  private saveCurrentAsTemplate(): void {
    const name = prompt('Template name:');
    if (!name || !name.trim()) return;

    // Gather current state
    const panelsGrid = document.getElementById('panelsGrid');
    const chartSection = document.getElementById('chartSection');
    const chartVisible = chartSection ? !chartSection.classList.contains('hidden') : true;

    const panelOrder: string[] = [];
    if (panelsGrid) {
      Array.from(panelsGrid.children).forEach(el => {
        const key = (el as HTMLElement).dataset.panel || (el as HTMLElement).dataset.lazyPanel;
        if (key && this.panelSettings[key]?.enabled) {
          panelOrder.push(key);
        }
      });
    }

    // Gather TV widget info
    const tvWidgetSlots: DashboardTemplate['tvWidgetSlots'] = [];
    panelOrder.forEach((key, idx) => {
      if (key.startsWith('tv-widget-')) {
        const panel = this.panels[key] as TradingViewWidgetPanel | undefined;
        if (panel) {
          const prevKey = (idx > 0 ? panelOrder[idx - 1] : '') ?? '';
          // Read state from localStorage
          try {
            const raw = localStorage.getItem(`hq-tv-widget-${key.replace('tv-widget-', '')}`);
            const state = raw ? JSON.parse(raw) : { symbol: 'BINANCE:BTCUSDT', interval: 'D' };
            tvWidgetSlots.push({ afterPanel: prevKey, symbol: state.symbol as string, interval: state.interval as string });
          } catch {
            tvWidgetSlots.push({ afterPanel: prevKey || '', symbol: 'BINANCE:BTCUSDT', interval: 'D' });
          }
        }
      }
    });

    const template: DashboardTemplate = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      description: `Custom layout with ${panelOrder.length} panels.`,
      icon: '⭐',
      chartVisible,
      panelOrder,
      tvWidgetSlots: tvWidgetSlots.length > 0 ? tvWidgetSlots : undefined,
      custom: true,
    };

    const customs = this.getCustomTemplates();
    customs.push(template);
    this.saveCustomTemplates(customs);
    localStorage.setItem(STORAGE_KEYS.activeTemplate, template.id);
    this.renderTemplatesGrid();
  }

  private setupPanelFilter(): void {
    const input = document.getElementById('panelFilterInput') as HTMLInputElement | null;
    const clearBtn = document.getElementById('panelFilterClear') as HTMLElement | null;
    const countLabel = document.getElementById('panelFilterCount') as HTMLElement | null;
    if (!input) return;

    const runFilter = (): void => {
      const query = input.value.trim().toLowerCase();
      const grid = document.getElementById('panelsGrid');
      if (!grid) return;

      // Toggle clear button visibility
      clearBtn?.classList.toggle('hidden', query.length === 0);

      const panels = grid.querySelectorAll('[data-panel], [data-lazy-panel]') as NodeListOf<HTMLElement>;
      let total = 0;
      let visible = 0;

      panels.forEach(el => {
        const key = el.dataset.panel || el.dataset.lazyPanel || '';
        const cfg = this.panelSettings[key];
        if (!cfg) return;

        // Disabled panels always stay hidden
        if (!cfg.enabled) {
          el.classList.remove('panel-filter-hidden');
          return;
        }

        total++;
        const name = (cfg.name || key).toLowerCase();
        const matches = !query || name.includes(query);
        el.classList.toggle('panel-filter-hidden', !matches);
        if (matches) visible++;
      });

      if (countLabel) {
        countLabel.textContent = query ? `Showing ${visible} of ${total}` : '';
      }
    };

    input.addEventListener('input', () => {
      cancelAnimationFrame(this.panelFilterDebounceId);
      this.panelFilterDebounceId = requestAnimationFrame(runFilter);
    });

    clearBtn?.addEventListener('click', () => {
      input.value = '';
      runFilter();
      input.focus();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // `/` focuses the filter (unless already in an input/textarea)
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        input.focus();
        return;
      }
      // Escape clears and blurs
      if (e.key === 'Escape' && document.activeElement === input) {
        input.value = '';
        runFilter();
        input.blur();
      }
    });
  }

  private applyPanelSettings(): void {
    Object.entries(this.panelSettings).forEach(([key, config]) => {
      if (key === 'chart' || key === 'map') {
        const chartSection = document.getElementById('chartSection');
        if (chartSection) {
          chartSection.classList.toggle('hidden', !config.enabled);
        }
        return;
      }
      const panel = this.panels[key];
      if (panel) {
        panel.toggle(config.enabled);
      } else {
        // Handle lazy panel placeholders
        const placeholder = document.querySelector(`[data-lazy-panel="${key}"]`) as HTMLElement;
        if (placeholder) {
          placeholder.style.display = config.enabled ? '' : 'none';
        }
      }
    });
  }

  private updateTime(): void {
    const now = new Date();
    const el = document.getElementById('timeDisplay');
    if (el) {
      el.textContent = now.toUTCString().split(' ')[4] + ' UTC';
    }
  }

  private async loadAllData(): Promise<void> {
    const runGuarded = async (name: string, fn: () => Promise<void>): Promise<void> => {
      if (this.inFlight.has(name)) return;
      this.inFlight.add(name);
      try {
        await fn();
      } finally {
        this.inFlight.delete(name);
      }
    };

    const tasks: Array<{ name: string; task: Promise<void> }> = [
      { name: 'news', task: runGuarded('news', () => this.loadNews()) },
      { name: 'markets', task: runGuarded('markets', () => this.loadMarkets()) },
      { name: 'predictions', task: runGuarded('predictions', () => this.loadPredictions()) },
    ];

    // Load data signals for risk calculation (protests, tracking, outages)
    // Only for geopolitical variant - tech variant doesn't need risk scoring/focal points
    if (SITE_VARIANT === 'full') {
      tasks.push({ name: 'signals', task: runGuarded('signals', () => this.loadDataSignals()) });
    }

    // Conditionally load non-intelligence layers
    // NOTE: outages, protests, tracking are handled by loadDataSignals() above
    // They update the map when layers are enabled, so no duplicate tasks needed here
    if (SITE_VARIANT === 'full') tasks.push({ name: 'firms', task: runGuarded('firms', () => this.loadFirmsData()) });
    if (this.mapLayers.natural) tasks.push({ name: 'natural', task: runGuarded('natural', () => this.loadNatural()) });
    if (this.mapLayers.weather) tasks.push({ name: 'weather', task: runGuarded('weather', () => this.loadWeatherAlerts()) });
    if (this.mapLayers.ais) tasks.push({ name: 'ais', task: runGuarded('ais', () => this.loadAisSignals()) });
    if (this.mapLayers.cables) tasks.push({ name: 'cables', task: runGuarded('cables', () => this.loadCableActivity()) });
    if (this.mapLayers.flights) tasks.push({ name: 'flights', task: runGuarded('flights', () => this.loadFlightDelays()) });
    if (CYBER_LAYER_ENABLED && this.mapLayers.cyberThreats) tasks.push({ name: 'securityThreats', task: runGuarded('securityThreats', () => this.loadSecurityThreats()) });
    if (this.mapLayers.techEvents || SITE_VARIANT === 'tech') tasks.push({ name: 'techEvents', task: runGuarded('techEvents', () => this.loadTechEvents()) });

    // Tech Readiness panel (tech variant only)
    if (SITE_VARIANT === 'tech') {
      tasks.push({ name: 'techReadiness', task: runGuarded('techReadiness', () => (this.panels['tech-readiness'] as TechReadinessPanel)?.refresh()) });
    }

    // Use allSettled to ensure all tasks complete and search index always updates
    const results = await Promise.allSettled(tasks.map(t => t.task));

    // Log any failures but don't block
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`[App] ${tasks[idx]?.name} load failed:`, result.reason);
      }
    });

    // Always update search index regardless of individual task failures
    this.updateSearchIndex();
  }

  private async loadDataForLayer(layer: keyof MapLayers): Promise<void> {
    if (this.inFlight.has(layer)) return;
    this.inFlight.add(layer);
    this.map?.setLayerLoading(layer, true);
    try {
      switch (layer) {
        case 'natural':
          await this.loadNatural();
          break;
        case 'fires':
          await this.loadFirmsData();
          break;
        case 'weather':
          await this.loadWeatherAlerts();
          break;
        case 'outages':
          await this.loadOutages();
          break;
        case 'cyberThreats':
          await this.loadSecurityThreats();
          break;
        case 'ais':
          await this.loadAisSignals();
          break;
        case 'cables':
          await this.loadCableActivity();
          break;
        case 'protests':
          await this.loadProtests();
          break;
        case 'flights':
          await this.loadFlightDelays();
          break;
        case 'military':
          await this.loadTrackedAssets();
          break;
        case 'techEvents':
          console.log('[loadDataForLayer] Loading techEvents...');
          await this.loadTechEvents();
          console.log('[loadDataForLayer] techEvents loaded');
          break;
        case 'ucdpEvents':
        case 'displacement':
        case 'climate':
          await this.loadDataSignals();
          break;
        case 'chainFlows':
          await this.loadBridgeFlows();
          break;
      }
    } finally {
      this.inFlight.delete(layer);
      this.map?.setLayerLoading(layer, false);
    }
  }

  private findFlashLocation(title: string): { lat: number; lon: number } | null {
    const titleLower = title.toLowerCase();
    let bestMatch: { lat: number; lon: number; matches: number } | null = null;

    const countKeywordMatches = (keywords: string[] | undefined): number => {
      if (!keywords) return 0;
      let matches = 0;
      for (const keyword of keywords) {
        const cleaned = keyword.trim().toLowerCase();
        if (cleaned.length >= 3 && titleLower.includes(cleaned)) {
          matches++;
        }
      }
      return matches;
    };

    for (const hotspot of FOCUS_AREAS) {
      const matches = countKeywordMatches(hotspot.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: hotspot.lat, lon: hotspot.lon, matches };
      }
    }

    for (const conflict of RISK_REGIONS) {
      const matches = countKeywordMatches(conflict.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: conflict.center[1], lon: conflict.center[0], matches };
      }
    }

    return bestMatch;
  }

  private flashMapForNews(items: NewsItem[]): void {
    if (!this.map || !this.initialLoadComplete) return;
    const now = Date.now();

    for (const [key, timestamp] of this.mapFlashCache.entries()) {
      if (now - timestamp > this.MAP_FLASH_COOLDOWN_MS) {
        this.mapFlashCache.delete(key);
      }
    }

    for (const item of items) {
      const cacheKey = `${item.source}|${item.link || item.title}`;
      const lastSeen = this.mapFlashCache.get(cacheKey);
      if (lastSeen && now - lastSeen < this.MAP_FLASH_COOLDOWN_MS) {
        continue;
      }

      const location = this.findFlashLocation(item.title);
      if (!location) continue;

      this.map.flashLocation(location.lat, location.lon);
      this.mapFlashCache.set(cacheKey, now);
    }
  }

  private async loadNewsCategory(category: string, feeds: typeof FEEDS.politics): Promise<NewsItem[]> {
    try {
      const panel = this.newsPanels[category];
      const renderIntervalMs = 250;
      let lastRenderTime = 0;
      let renderTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingItems: NewsItem[] | null = null;

      // Filter out disabled sources
      const enabledFeeds = (feeds ?? []).filter(f => !this.disabledSources.has(f.name));
      if (enabledFeeds.length === 0) {
        if (panel) panel.showError('All sources disabled');
        this.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: 0,
        });
        return [];
      }

      const flushPendingRender = () => {
        if (!panel || !pendingItems) return;
        panel.renderNews(pendingItems);
        pendingItems = null;
        lastRenderTime = Date.now();
      };

      const scheduleRender = (partialItems: NewsItem[]) => {
        if (!panel) return;
        pendingItems = partialItems;
        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= renderIntervalMs) {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
          }
          flushPendingRender();
          return;
        }

        if (!renderTimeout) {
          renderTimeout = setTimeout(() => {
            renderTimeout = null;
            flushPendingRender();
          }, renderIntervalMs - elapsed);
        }
      };

      const items = await fetchCategoryFeeds(enabledFeeds, {
        onBatch: (partialItems) => {
          scheduleRender(partialItems);
          this.flashMapForNews(partialItems);
        },
      });

      if (panel) {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
          renderTimeout = null;
          pendingItems = null;
        }
        panel.renderNews(items);

        const baseline = await updateBaseline(`news:${category}`, items.length);
        const deviation = calculateDeviation(items.length, baseline);
        panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
      }

      this.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'ok',
        itemCount: items.length,
      });
      this.statusPanel?.updateApi('RSS2JSON', { status: 'ok' });

      return items;
    } catch (error) {
      this.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'error',
        errorMessage: String(error),
      });
      this.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
      return [];
    }
  }

  private async loadNews(): Promise<void> {
    // Build categories dynamically based on what feeds exist
    const allCategories = [
      { key: 'politics', feeds: FEEDS.politics },
      { key: 'tech', feeds: FEEDS.tech },
      { key: 'finance', feeds: FEEDS.finance },
      { key: 'gov', feeds: FEEDS.gov },
      { key: 'middleeast', feeds: FEEDS.middleeast },
      { key: 'africa', feeds: FEEDS.africa },
      { key: 'latam', feeds: FEEDS.latam },
      { key: 'asia', feeds: FEEDS.asia },
      { key: 'energy', feeds: FEEDS.energy },
      { key: 'ai', feeds: FEEDS.ai },
      { key: 'thinktanks', feeds: FEEDS.thinktanks },
      // Tech variant categories
      { key: 'startups', feeds: FEEDS.startups },
      { key: 'vcblogs', feeds: FEEDS.vcblogs },
      { key: 'regionalStartups', feeds: FEEDS.regionalStartups },
      { key: 'unicorns', feeds: FEEDS.unicorns },
      { key: 'accelerators', feeds: FEEDS.accelerators },
      { key: 'funding', feeds: FEEDS.funding },
      { key: 'producthunt', feeds: FEEDS.producthunt },
      { key: 'security', feeds: FEEDS.security },
      { key: 'policy', feeds: FEEDS.policy },
      { key: 'hardware', feeds: FEEDS.hardware },
      { key: 'cloud', feeds: FEEDS.cloud },
      { key: 'dev', feeds: FEEDS.dev },
      { key: 'github', feeds: FEEDS.github },
      { key: 'ipo', feeds: FEEDS.ipo },
    ];
    // Filter to only categories that have feeds defined
    const categories = allCategories.filter(c => c.feeds && c.feeds.length > 0);

    // Fetch all categories in parallel
    const categoryResults = await Promise.allSettled(
      categories.map(({ key, feeds }) => this.loadNewsCategory(key, feeds))
    );

    // Collect successful results
    const collectedNews: NewsItem[] = [];
    categoryResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        collectedNews.push(...result.value);
      } else {
        console.error(`[App] News category ${categories[idx]?.key} failed:`, result.reason);
      }
    });

    // Research: uses different source) - full variant only (defense/geopolitical news
    if (SITE_VARIANT === 'full') {
      const enabledIntelSources = RESEARCH_SOURCES.filter(f => !this.disabledSources.has(f.name));
      const intelPanel = this.newsPanels['intel'];
      if (enabledIntelSources.length === 0) {
        if (intelPanel) intelPanel.showError('All Intel sources disabled');
        this.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: 0 });
      } else {
        const intelResult = await Promise.allSettled([fetchCategoryFeeds(enabledIntelSources)]);
        if (intelResult[0]?.status === 'fulfilled') {
          const intel = intelResult[0].value;
          if (intelPanel) {
            intelPanel.renderNews(intel);
            const baseline = await updateBaseline('news:intel', intel.length);
            const deviation = calculateDeviation(intel.length, baseline);
            intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
          }
          this.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
          collectedNews.push(...intel);
          this.flashMapForNews(intel);
        } else {
          console.error('[App] Intel feed failed:', intelResult[0]?.reason);
        }
      }
    }

    this.allNews = collectedNews;
    this.initialLoadComplete = true;
    // Temporal baseline: report news volume
    updateAndCheck([
      { type: 'news', region: 'global', count: collectedNews.length },
    ]).then(anomalies => {
      if (anomalies.length > 0) {
        signalAggregator.ingestTemporalAnomalies(anomalies);
        for (const a of anomalies) {
          this.notificationCenter?.push({
            type: 'anomaly',
            title: `Temporal Anomaly: ${a.type}`,
            body: `${a.message} (z-score: ${a.zScore.toFixed(1)})`,
            priority: a.severity === 'critical' ? 'critical' : a.severity === 'high' ? 'high' : 'medium',
          });
        }
      }
    }).catch(() => {});

    // Update monitors
    this.updateMonitorResults();

    // Update clusters for correlation analysis (hybrid: semantic + Jaccard when ML available)
    try {
      this.latestClusters = mlWorker.isAvailable
        ? await clusterNewsHybrid(this.allNews)
        : await analysisWorker.clusterNews(this.allNews);

      // Update AI Insights panel with new clusters (if ML available)
      if (mlWorker.isAvailable && this.latestClusters.length > 0) {
        const insightsPanel = this.panels['insights'] as InsightsPanel | undefined;
        insightsPanel?.updateInsights(this.latestClusters);
      }

      // Push geo-located news clusters to map
      const geoLocated = this.latestClusters
        .filter((c): c is typeof c & { lat: number; lon: number } => c.lat != null && c.lon != null)
        .map(c => ({
          lat: c.lat,
          lon: c.lon,
          title: c.primaryTitle,
          threatLevel: c.threat?.level ?? 'info',
        }));
      if (geoLocated.length > 0) {
        this.map?.setNewsLocations(geoLocated);
      }
    } catch (error) {
      console.error('[App] Clustering failed, clusters unchanged:', error);
    }
  }

  private async loadMarkets(): Promise<void> {
    try {
      // Stocks
      const stocks = await fetchMultipleStocks(MARKET_SYMBOLS, {
        onBatch: (partialStocks) => {
          this.latestMarkets = partialStocks;
          (this.panels['markets'] as MarketPanel).renderMarkets(partialStocks);
        },
      });
      this.latestMarkets = stocks;
      (this.panels['markets'] as MarketPanel).renderMarkets(stocks);
      this.statusPanel?.updateApi('Finnhub', { status: 'ok' });

      // Sectors
      const sectors = await fetchMultipleStocks(
        SECTORS.map((s) => ({ ...s, display: s.name })),
        {
          onBatch: (partialSectors) => {
            (this.panels['heatmap'] as HeatmapPanel).renderHeatmap(
              partialSectors.map((s) => ({ name: s.name, change: s.change }))
            );
          },
        }
      );
      (this.panels['heatmap'] as HeatmapPanel).renderHeatmap(
        sectors.map((s) => ({ name: s.name, change: s.change }))
      );

      // Commodities
      const commodities = await fetchMultipleStocks(COMMODITIES, {
        onBatch: (partialCommodities) => {
          (this.panels['commodities'] as CommoditiesPanel).renderCommodities(
            partialCommodities.map((c) => ({
              display: c.display,
              price: c.price,
              change: c.change,
              sparkline: c.sparkline,
            }))
          );
        },
      });
      (this.panels['commodities'] as CommoditiesPanel).renderCommodities(
        commodities.map((c) => ({ display: c.display, price: c.price, change: c.change, sparkline: c.sparkline }))
      );
    } catch {
      this.statusPanel?.updateApi('Finnhub', { status: 'error' });
    }

    try {
      // Crypto
      const crypto = await fetchCrypto();
      (this.panels['crypto'] as CryptoPanel).renderCrypto(crypto);
      this.statusPanel?.updateApi('CoinGecko', { status: 'ok' });
    } catch {
      this.statusPanel?.updateApi('CoinGecko', { status: 'error' });
    }

    // Notify parent frame (debounced)
    this.emitBridgeMarketUpdate();
  }

  private async loadPredictions(): Promise<void> {
    try {
      const predictions = await fetchPredictions();
      this.latestPredictions = predictions;
      (this.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

      this.statusPanel?.updateFeed('Polymarket', { status: 'ok', itemCount: predictions.length });
      this.statusPanel?.updateApi('Polymarket', { status: 'ok' });
      dataFreshness.recordUpdate('polymarket', predictions.length);

      // Run correlation analysis in background (fire-and-forget via Web Worker)
      void this.runCorrelationAnalysis();
    } catch (error) {
      this.statusPanel?.updateFeed('Polymarket', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('Polymarket', { status: 'error' });
      dataFreshness.recordError('polymarket', String(error));
    }
  }

  private async loadNatural(): Promise<void> {
    // Load both USGS earthquakes and NASA EONET natural events in parallel
    const [earthquakeResult, eonetResult] = await Promise.allSettled([
      fetchEarthquakes(),
      fetchNaturalEvents(30),
    ]);

    // Handle earthquakes (USGS)
    if (earthquakeResult.status === 'fulfilled') {
      this.signalCache.earthquakes = earthquakeResult.value;
      this.map?.setEarthquakes(earthquakeResult.value);
      ingestEarthquakes(earthquakeResult.value);
      this.statusPanel?.updateApi('USGS', { status: 'ok' });
      dataFreshness.recordUpdate('usgs', earthquakeResult.value.length);
    } else {
      this.signalCache.earthquakes = [];
      this.map?.setEarthquakes([]);
      this.statusPanel?.updateApi('USGS', { status: 'error' });
      dataFreshness.recordError('usgs', String(earthquakeResult.reason));
    }

    // Handle natural events (EONET - storms, fires, volcanoes, etc.)
    if (eonetResult.status === 'fulfilled') {
      this.map?.setNaturalEvents(eonetResult.value);
      this.statusPanel?.updateFeed('EONET', {
        status: 'ok',
        itemCount: eonetResult.value.length,
      });
      this.statusPanel?.updateApi('NASA EONET', { status: 'ok' });
    } else {
      this.map?.setNaturalEvents([]);
      this.statusPanel?.updateFeed('EONET', { status: 'error', errorMessage: String(eonetResult.reason) });
      this.statusPanel?.updateApi('NASA EONET', { status: 'error' });
    }

    // Set layer ready based on combined data
    const hasEarthquakes = earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length > 0;
    const hasEonet = eonetResult.status === 'fulfilled' && eonetResult.value.length > 0;
    this.map?.setLayerReady('natural', hasEarthquakes || hasEonet);
  }

  private async loadTechEvents(): Promise<void> {
    console.log('[loadTechEvents] Called. SITE_VARIANT:', SITE_VARIANT, 'techEvents layer:', this.mapLayers.techEvents);
    // Only load for tech variant or if techEvents layer is enabled
    if (SITE_VARIANT !== 'tech' && !this.mapLayers.techEvents) {
      console.log('[loadTechEvents] Skipping - not tech variant and layer disabled');
      return;
    }

    try {
      const res = await fetch('/api/tech-events?type=conference&mappable=true&days=90&limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      // Transform events for map markers
      const now = new Date();
      const mapEvents = data.events.map((e: {
        id: string;
        title: string;
        location: string;
        coords: { lat: number; lng: number; country: string };
        startDate: string;
        endDate: string;
        url: string | null;
      }) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        lat: e.coords.lat,
        lng: e.coords.lng,
        country: e.coords.country,
        startDate: e.startDate,
        endDate: e.endDate,
        url: e.url,
        daysUntil: Math.ceil((new Date(e.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      }));

      this.map?.setTechEvents(mapEvents);
      this.map?.setLayerReady('techEvents', mapEvents.length > 0);
      this.statusPanel?.updateFeed('Tech Events', { status: 'ok', itemCount: mapEvents.length });

      // Register tech events as searchable source
      if (SITE_VARIANT === 'tech' && this.searchModal) {
        this.searchModal.registerSource('techevent', mapEvents.map((e: { id: string; title: string; location: string; startDate: string }) => ({
          id: e.id,
          title: e.title,
          subtitle: `${e.location} • ${new Date(e.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          data: e,
        })));
      }
    } catch (error) {
      console.error('[App] Failed to load tech events:', error);
      this.map?.setTechEvents([]);
      this.map?.setLayerReady('techEvents', false);
      this.statusPanel?.updateFeed('Tech Events', { status: 'error', errorMessage: String(error) });
    }
  }

  private async loadWeatherAlerts(): Promise<void> {
    try {
      const alerts = await fetchWeatherAlerts();
      this.map?.setWeatherAlerts(alerts);
      this.map?.setLayerReady('weather', alerts.length > 0);
      this.statusPanel?.updateFeed('Weather', { status: 'ok', itemCount: alerts.length });
      dataFreshness.recordUpdate('weather', alerts.length);
    } catch (error) {
      this.map?.setLayerReady('weather', false);
      this.statusPanel?.updateFeed('Weather', { status: 'error' });
      dataFreshness.recordError('weather', String(error));
    }
  }

  // Cache for signal data - allows risk scoring to work even when layers are disabled
  private signalCache: {
    outages?: InternetOutage[];
    protests?: { events: SocialUnrestEvent[]; sources: { acled: number; gdelt: number } };
    tracking?: { flights: TrackedFlight[]; flightClusters: FlightCluster[]; vessels: TrackedVessel[]; vesselClusters: VesselCluster[] };
    earthquakes?: import('@/types').Earthquake[];
  } = {};
  private securityThreatsCache: SecurityThreat[] | null = null;

  /**
   * Load critical signals for risk scoring/focal point calculation
   * This runs ALWAYS, regardless of layer visibility
   * Map rendering is separate and still gated by layer visibility
   */
  private async loadBridgeFlows(): Promise<void> {
    try {
      const res = await fetch('/api/bridge-flows');
      if (!res.ok) return;
      const data = await res.json();
      const flows = data?.flows || [];
      if (flows.length > 0) {
        this.map?.setBridgeFlows(flows);
      }
    } catch (error) {
      console.warn('[Data] Bridge flows fetch failed:', error);
    }
  }

  private async loadDataSignals(): Promise<void> {
    const tasks: Promise<void>[] = [];

    // Always fetch outages for risk scoring (internet blackouts = major instability signal)
    tasks.push((async () => {
      try {
        const outages = await fetchInternetOutages();
        this.signalCache.outages = outages;
        ingestOutagesForRisk(outages);
        signalAggregator.ingestOutages(outages);
        dataFreshness.recordUpdate('outages', outages.length);
        // Update map only if layer is visible
        if (this.mapLayers.outages) {
          this.map?.setOutages(outages);
          this.map?.setLayerReady('outages', outages.length > 0);
          this.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
        }
      } catch (error) {
        console.error('[Data] Outages fetch failed:', error);
        dataFreshness.recordError('outages', String(error));
      }
    })());

    // Always fetch protests for risk scoring (unrest = core instability metric)
    // This task is also used by UCDP deduplication, so keep it as a shared promise.
    const protestsTask = (async (): Promise<SocialUnrestEvent[]> => {
      try {
        const protestData = await fetchProtestEvents();
        this.signalCache.protests = protestData;
        ingestProtests(protestData.events);
        ingestProtestsForRisk(protestData.events);
        signalAggregator.ingestProtests(protestData.events);
        const protestCount = protestData.sources.acled + protestData.sources.gdelt;
        if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
        // Update map only if layer is visible
        if (this.mapLayers.protests) {
          this.map?.setProtests(protestData.events);
          this.map?.setLayerReady('protests', protestData.events.length > 0);
          const status = getProtestStatus();
          this.statusPanel?.updateFeed('Protests', {
            status: 'ok',
            itemCount: protestData.events.length,
            errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
          });
        }
        return protestData.events;
      } catch (error) {
        console.error('[Data] Protests fetch failed:', error);
        dataFreshness.recordError('acled', String(error));
        return [];
      }
    })();
    tasks.push(protestsTask.then(() => undefined));

    // Fetch armed conflict events (battles, explosions, violence) for risk scoring
    tasks.push((async () => {
      try {
        const conflictData = await fetchConflictEvents();
        ingestConflictsForRisk(conflictData.events);
        if (conflictData.count > 0) dataFreshness.recordUpdate('acled_conflict', conflictData.count);
      } catch (error) {
        console.error('[Data] Conflict events fetch failed:', error);
        dataFreshness.recordError('acled_conflict', String(error));
      }
    })());

    // Fetch UCDP conflict classifications (war vs minor vs none)
    tasks.push((async () => {
      try {
        const classifications = await fetchUcdpClassifications();
        ingestUcdpForRisk(classifications);
        if (classifications.size > 0) dataFreshness.recordUpdate('ucdp', classifications.size);
      } catch (error) {
        console.error('[Data] UCDP fetch failed:', error);
        dataFreshness.recordError('ucdp', String(error));
      }
    })());

    // Fetch HDX HAPI aggregated conflict data (fallback/validation)
    tasks.push((async () => {
      try {
        const summaries = await fetchHapiSummary();
        ingestHapiForRisk(summaries);
        if (summaries.size > 0) dataFreshness.recordUpdate('hapi', summaries.size);
      } catch (error) {
        console.error('[Data] HAPI fetch failed:', error);
        dataFreshness.recordError('hapi', String(error));
      }
    })());

    // Always fetch tracking data for risk scoring (security = core metric)
    tasks.push((async () => {
      try {
        if (isVesselTrackingConfigured()) {
          initVesselStream();
        }
        const [flightData, vesselData] = await Promise.all([
          fetchTrackedFlights(),
          fetchTrackedVessels(),
        ]);
        this.signalCache.tracking = {
          flights: flightData.flights,
          flightClusters: flightData.clusters,
          vessels: vesselData.vessels,
          vesselClusters: vesselData.clusters,
        };
        ingestFlights(flightData.flights);
        ingestVessels(vesselData.vessels);
        ingestActivityData(flightData.flights, vesselData.vessels);
        signalAggregator.ingestFlights(flightData.flights);
        signalAggregator.ingestVessels(vesselData.vessels);
        dataFreshness.recordUpdate('opensky', flightData.flights.length);
        // Temporal baseline: report counts and check for anomalies
        updateAndCheck([
          { type: 'tracked_flights', region: 'global', count: flightData.flights.length },
          { type: 'vessels', region: 'global', count: vesselData.vessels.length },
        ]).then(anomalies => {
          if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
        }).catch(() => {});
        // Update map only if layer is visible
        if (this.mapLayers.military) {
          this.map?.setTrackedFlights(flightData.flights, flightData.clusters);
          this.map?.setTrackedVessels(vesselData.vessels, vesselData.clusters);
          this.map?.updateActivityForEscalation(flightData.flights, vesselData.vessels);
          const trackingCount = flightData.flights.length + vesselData.vessels.length;
          this.statusPanel?.updateFeed('Tracking', {
            status: trackingCount > 0 ? 'ok' : 'warning',
            itemCount: trackingCount,
          });
        }
        // Detect airlift surges and foreign presence (suppress during learning mode)
        if (!isInLearningMode()) {
          const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
          if (surgeAlerts.length > 0) {
            const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
            addToSignalHistory(surgeSignals);
          }
          const foreignAlerts = detectForeignPresence(flightData.flights);
          if (foreignAlerts.length > 0) {
            const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
            addToSignalHistory(foreignSignals);
          }
        }
      } catch (error) {
        console.error('[Data] Tracking fetch failed:', error);
        dataFreshness.recordError('opensky', String(error));
      }
    })());

    // Fetch UCDP georeferenced events (battles, one-sided violence, non-state conflict)
    tasks.push((async () => {
      try {
        const [result, protestEvents] = await Promise.all([
          fetchUcdpEvents(),
          protestsTask,
        ]);
        if (!result.success) {
          dataFreshness.recordError('ucdp_events', 'UCDP events unavailable (retaining prior event state)');
          return;
        }
        const acledEvents = protestEvents.map(e => ({
          latitude: e.lat, longitude: e.lon, event_date: e.time.toISOString(), fatalities: e.fatalities ?? 0,
        }));
        const events = deduplicateAgainstAcled(result.data, acledEvents);
        (this.panels['geo-events'] as UcdpEventsPanel)?.setEvents(events);
        if (this.mapLayers.ucdpEvents) {
          this.map?.setUcdpEvents(events);
        }
        if (events.length > 0) dataFreshness.recordUpdate('ucdp_events', events.length);
      } catch (error) {
        console.error('[Data] UCDP events fetch failed:', error);
        dataFreshness.recordError('ucdp_events', String(error));
      }
    })());

    // Fetch UNHCR displacement data (refugees, asylum seekers, IDPs)
    tasks.push((async () => {
      try {
        const unhcrResult = await fetchUnhcrPopulation();
        if (!unhcrResult.ok) {
          dataFreshness.recordError('unhcr', 'UNHCR displacement unavailable (retaining prior displacement state)');
          return;
        }
        const data = unhcrResult.data;
        (this.panels['flow-tracker'] as DisplacementPanel)?.setData(data);
        ingestDisplacementForRisk(data.countries);
        if (this.mapLayers.displacement && data.topFlows) {
          this.map?.setDisplacementFlows(data.topFlows);
        }
        if (data.countries.length > 0) dataFreshness.recordUpdate('unhcr', data.countries.length);
      } catch (error) {
        console.error('[Data] UNHCR displacement fetch failed:', error);
        dataFreshness.recordError('unhcr', String(error));
      }
    })());

    // Fetch climate anomalies (temperature/precipitation deviations)
    tasks.push((async () => {
      try {
        const climateResult = await fetchClimateAnomalies();
        if (!climateResult.ok) {
          dataFreshness.recordError('climate', 'Climate anomalies unavailable (retaining prior climate state)');
          return;
        }
        const anomalies = climateResult.anomalies;
        (this.panels['climate'] as ClimateAnomalyPanel)?.setAnomalies(anomalies);
        ingestClimateForRisk(anomalies);
        if (this.mapLayers.climate) {
          this.map?.setClimateAnomalies(anomalies);
        }
        if (anomalies.length > 0) dataFreshness.recordUpdate('climate', anomalies.length);
      } catch (error) {
        console.error('[Data] Climate anomalies fetch failed:', error);
        dataFreshness.recordError('climate', String(error));
      }
    })());

    // Fetch cross-chain bridge flow data for globe arcs
    tasks.push((async () => {
      try {
        const res = await fetch('/api/bridge-flows');
        if (!res.ok) return;
        const data = await res.json();
        const flows = data?.flows || [];
        if (flows.length > 0 && this.mapLayers.chainFlows) {
          this.map?.setBridgeFlows(flows);
        }
      } catch (error) {
        console.warn('[Data] Bridge flows fetch failed:', error);
      }
    })());

    await Promise.allSettled(tasks);

    // Fetch population exposure estimates after upstream data loads complete.
    // This avoids race conditions where UCDP/protest data is still in-flight.
    try {
      const ucdpEvts = (this.panels['geo-events'] as UcdpEventsPanel)?.getEvents?.() || [];
      const events = [
        ...(this.signalCache.protests?.events || []).slice(0, 10).map(e => ({
          id: e.id, lat: e.lat, lon: e.lon, type: 'conflict' as const, name: e.title || 'Protest',
        })),
        ...ucdpEvts.slice(0, 10).map(e => ({
          id: e.id, lat: e.latitude, lon: e.longitude, type: e.type_of_violence as string, name: `${e.side_a} vs ${e.side_b}`,
        })),
      ];
      if (events.length > 0) {
        const exposures = await enrichEventsWithExposure(events);
        (this.panels['population-exposure'] as PopulationExposurePanel)?.setExposures(exposures);
        if (exposures.length > 0) dataFreshness.recordUpdate('worldpop', exposures.length);
      }
    } catch (error) {
      console.error('[Data] Population exposure fetch failed:', error);
      dataFreshness.recordError('worldpop', String(error));
    }

    // Now trigger risk score refresh with all signal data
    (this.panels['cri'] as CIIPanel)?.refresh();
    console.log('[Signals] All data loaded for risk calculation');

    // Check for notification-worthy signals
    this.checkSignalNotifications();

    // Notify parent frame of signal activity (debounced)
    this.emitBridgeSignalDetected();
  }

  /**
   * Evaluate signal aggregator state and push notifications for:
   * - Regional convergence zones
   * - Country instability score jumps (10+ points)
   * - Fear & Greed extremes (<20 or >80)
   */
  private checkSignalNotifications(): void {
    if (!this.notificationCenter) return;

    // 1. Regional convergence from signal aggregator
    const convergenceZones = signalAggregator.getRegionalConvergence();
    for (const zone of convergenceZones) {
      if (zone.totalSignals >= 5) {
        this.notificationCenter.push({
          type: 'convergence',
          title: `Regional Convergence: ${zone.region}`,
          body: `${zone.description} - ${zone.totalSignals} signals across ${zone.countries.length} countries`,
          priority: zone.totalSignals >= 12 ? 'critical' : zone.totalSignals >= 8 ? 'high' : 'medium',
        });
      }
    }

    // 2. Country instability jumps (10+ point increase)
    const currentScores = calculateRiskScores();
    for (const score of currentScores) {
      const prev = this.prevRiskScores.get(score.code) ?? score.score;
      const jump = score.score - prev;
      if (jump >= 10) {
        this.notificationCenter.push({
          type: 'instability',
          title: `Instability Spike: ${score.name}`,
          body: `Risk score jumped +${jump.toFixed(0)} to ${score.score.toFixed(0)}/100 (${score.level})`,
          priority: score.score >= 70 ? 'critical' : score.score >= 50 ? 'high' : 'medium',
          country: score.code,
          actionLabel: 'View Country',
        });
      }
    }
    // Update previous scores for next comparison
    this.prevRiskScores = new Map(currentScores.map(s => [s.code, s.score]));

    // 3. Fear & Greed extremes - fetch async (fire-and-forget)
    this.checkFearGreedNotification();
  }

  private async checkFearGreedNotification(): Promise<void> {
    try {
      const res = await fetch('/api/fear-greed?limit=1');
      if (!res.ok) return;
      const data = await res.json();
      const value = data?.data?.[0]?.value ?? data?.value;
      if (typeof value !== 'number') return;
      if (value < 20) {
        this.notificationCenter?.push({
          type: 'market',
          title: 'Extreme Fear',
          body: `Fear & Greed Index at ${value}/100 - market in extreme fear territory`,
          priority: value < 10 ? 'critical' : 'high',
        });
      } else if (value > 80) {
        this.notificationCenter?.push({
          type: 'market',
          title: 'Extreme Greed',
          body: `Fear & Greed Index at ${value}/100 - market in extreme greed territory`,
          priority: value > 90 ? 'critical' : 'high',
        });
      }
    } catch {
      // Non-critical, ignore
    }
  }

  private async loadOutages(): Promise<void> {
    // Use cached data if available
    if (this.signalCache.outages) {
      const outages = this.signalCache.outages;
      this.map?.setOutages(outages);
      this.map?.setLayerReady('outages', outages.length > 0);
      this.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      return;
    }
    try {
      const outages = await fetchInternetOutages();
      this.signalCache.outages = outages;
      this.map?.setOutages(outages);
      this.map?.setLayerReady('outages', outages.length > 0);
      ingestOutagesForRisk(outages);
      signalAggregator.ingestOutages(outages);
      this.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      dataFreshness.recordUpdate('outages', outages.length);
    } catch (error) {
      this.map?.setLayerReady('outages', false);
      this.statusPanel?.updateFeed('NetBlocks', { status: 'error' });
      dataFreshness.recordError('outages', String(error));
    }
  }

  private async loadSecurityThreats(): Promise<void> {
    if (!CYBER_LAYER_ENABLED) {
      this.mapLayers.cyberThreats = false;
      this.map?.setLayerReady('cyberThreats', false);
      return;
    }

    if (this.securityThreatsCache) {
      this.map?.setCyberThreats(this.securityThreatsCache);
      this.map?.setLayerReady('cyberThreats', this.securityThreatsCache.length > 0);
      this.statusPanel?.updateFeed('Security Threats', { status: 'ok', itemCount: this.securityThreatsCache.length });
      return;
    }

    try {
      const threats = await fetchCyberThreats({ limit: 500, days: 14 });
      this.securityThreatsCache = threats;
      this.map?.setCyberThreats(threats);
      this.map?.setLayerReady('cyberThreats', threats.length > 0);
      this.statusPanel?.updateFeed('Security Threats', { status: 'ok', itemCount: threats.length });
      dataFreshness.recordUpdate('cyber_threats', threats.length);
    } catch (error) {
      this.map?.setLayerReady('cyberThreats', false);
      this.statusPanel?.updateFeed('Security Threats', { status: 'error', errorMessage: String(error) });
      dataFreshness.recordError('cyber_threats', String(error));
    }
  }

  private async loadAisSignals(): Promise<void> {
    try {
      const { disruptions, density } = await fetchAisSignals();
      const aisStatus = getAisStatus();
      console.log('[Ships] Events:', { disruptions: disruptions.length, density: density.length, vessels: aisStatus.vessels });
      this.map?.setAisData(disruptions, density);
      signalAggregator.ingestAisDisruptions(disruptions);
      // Temporal baseline: report AIS gap counts
      updateAndCheck([
        { type: 'ais_gaps', region: 'global', count: disruptions.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => {});

      const hasData = disruptions.length > 0 || density.length > 0;
      this.map?.setLayerReady('ais', hasData);

      const shippingCount = disruptions.length + density.length;
      const shippingStatus = shippingCount > 0 ? 'ok' : (aisStatus.connected ? 'warning' : 'error');
      this.statusPanel?.updateFeed('Shipping', {
        status: shippingStatus,
        itemCount: shippingCount,
        errorMessage: !aisStatus.connected && shippingCount === 0 ? 'Protocol signal unavailable' : undefined,
      });
      this.statusPanel?.updateApi('AISStream', {
        status: aisStatus.connected ? 'ok' : 'warning',
      });
      if (hasData) {
        dataFreshness.recordUpdate('ais', shippingCount);
      }
    } catch (error) {
      this.map?.setLayerReady('ais', false);
      this.statusPanel?.updateFeed('Shipping', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('AISStream', { status: 'error' });
      dataFreshness.recordError('ais', String(error));
    }
  }

  private waitForAisData(): void {
    const maxAttempts = 30;
    let attempts = 0;

    const checkData = () => {
      attempts++;
      const status = getAisStatus();

      if (status.vessels > 0 || status.connected) {
        this.loadAisSignals();
        this.map?.setLayerLoading('ais', false);
        return;
      }

      if (attempts >= maxAttempts) {
        this.map?.setLayerLoading('ais', false);
        this.map?.setLayerReady('ais', false);
        this.statusPanel?.updateFeed('Shipping', {
          status: 'error',
          errorMessage: 'Connection timeout'
        });
        return;
      }

      setTimeout(checkData, 1000);
    };

    checkData();
  }

  private async loadCableActivity(): Promise<void> {
    try {
      const activity = await fetchCableActivity();
      this.map?.setCableActivity(activity.advisories, activity.repairShips);
      const itemCount = activity.advisories.length + activity.repairShips.length;
      this.statusPanel?.updateFeed('CableOps', { status: 'ok', itemCount });
    } catch {
      this.statusPanel?.updateFeed('CableOps', { status: 'error' });
    }
  }

  private async loadProtests(): Promise<void> {
    // Use cached data if available (from loadDataSignals)
    if (this.signalCache.protests) {
      const protestData = this.signalCache.protests;
      this.map?.setProtests(protestData.events);
      this.map?.setLayerReady('protests', protestData.events.length > 0);
      const status = getProtestStatus();
      this.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.statusPanel?.updateApi('GDELT', { status: 'ok' });
      return;
    }
    try {
      const protestData = await fetchProtestEvents();
      this.signalCache.protests = protestData;
      this.map?.setProtests(protestData.events);
      this.map?.setLayerReady('protests', protestData.events.length > 0);
      ingestProtests(protestData.events);
      ingestProtestsForRisk(protestData.events);
      signalAggregator.ingestProtests(protestData.events);
      const protestCount = protestData.sources.acled + protestData.sources.gdelt;
      if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
      (this.panels['cri'] as CIIPanel)?.refresh();
      const status = getProtestStatus();
      this.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.statusPanel?.updateApi('GDELT', { status: 'ok' });
    } catch (error) {
      this.map?.setLayerReady('protests', false);
      this.statusPanel?.updateFeed('Protests', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('ACLED', { status: 'error' });
      this.statusPanel?.updateApi('GDELT', { status: 'error' });
    }
  }

  private async loadFlightDelays(): Promise<void> {
    try {
      const delays = await fetchFlightDelays();
      this.map?.setFlightDelays(delays);
      this.map?.setLayerReady('flights', delays.length > 0);
      this.statusPanel?.updateFeed('Flights', {
        status: 'ok',
        itemCount: delays.length,
      });
      this.statusPanel?.updateApi('FAA', { status: 'ok' });
    } catch (error) {
      this.map?.setLayerReady('flights', false);
      this.statusPanel?.updateFeed('Flights', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('FAA', { status: 'error' });
    }
  }

  private async loadTrackedAssets(): Promise<void> {
    // Use cached data if available (from loadDataSignals)
    if (this.signalCache.tracking) {
      const { flights, flightClusters, vessels, vesselClusters } = this.signalCache.tracking;
      this.map?.setTrackedFlights(flights, flightClusters);
      this.map?.setTrackedVessels(vessels, vesselClusters);
      this.map?.updateActivityForEscalation(flights, vessels);
      // Fetch cached postures for banner (posture panel fetches its own data)
      this.loadCachedPosturesForBanner();
      const insightsPanel = this.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setTrackedFlights(flights);
      const hasData = flights.length > 0 || vessels.length > 0;
      this.map?.setLayerReady('military', hasData);
      const assetCount = flights.length + vessels.length;
      this.statusPanel?.updateFeed('Tracking', {
        status: assetCount > 0 ? 'ok' : 'warning',
        itemCount: assetCount,
        errorMessage: assetCount === 0 ? 'No whale activity in view' : undefined,
      });
      this.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      return;
    }
    try {
      if (isVesselTrackingConfigured()) {
        initVesselStream();
      }
      const [flightData, vesselData] = await Promise.all([
        fetchTrackedFlights(),
        fetchTrackedVessels(),
      ]);
      this.signalCache.tracking = {
        flights: flightData.flights,
        flightClusters: flightData.clusters,
        vessels: vesselData.vessels,
        vesselClusters: vesselData.clusters,
      };
      this.map?.setTrackedFlights(flightData.flights, flightData.clusters);
      this.map?.setTrackedVessels(vesselData.vessels, vesselData.clusters);
      ingestFlights(flightData.flights);
      ingestVessels(vesselData.vessels);
      ingestActivityData(flightData.flights, vesselData.vessels);
      signalAggregator.ingestFlights(flightData.flights);
      signalAggregator.ingestVessels(vesselData.vessels);
      // Temporal baseline: report counts from standalone asset load
      updateAndCheck([
        { type: 'tracked_flights', region: 'global', count: flightData.flights.length },
        { type: 'vessels', region: 'global', count: vesselData.vessels.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => {});
      this.map?.updateActivityForEscalation(flightData.flights, vesselData.vessels);
      (this.panels['cri'] as CIIPanel)?.refresh();
      if (!isInLearningMode()) {
        const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
        if (surgeAlerts.length > 0) {
          const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
          addToSignalHistory(surgeSignals);
        }
        const foreignAlerts = detectForeignPresence(flightData.flights);
        if (foreignAlerts.length > 0) {
          const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
          addToSignalHistory(foreignSignals);
        }
      }

      // Fetch cached postures for banner (posture panel fetches its own data)
      this.loadCachedPosturesForBanner();
      const insightsPanel = this.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setTrackedFlights(flightData.flights);

      const hasData = flightData.flights.length > 0 || vesselData.vessels.length > 0;
      this.map?.setLayerReady('military', hasData);
      const assetCount = flightData.flights.length + vesselData.vessels.length;
      this.statusPanel?.updateFeed('Tracking', {
        status: assetCount > 0 ? 'ok' : 'warning',
        itemCount: assetCount,
        errorMessage: assetCount === 0 ? 'No whale activity in view' : undefined,
      });
      this.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      dataFreshness.recordUpdate('opensky', flightData.flights.length);
    } catch (error) {
      this.map?.setLayerReady('military', false);
      this.statusPanel?.updateFeed('Tracking', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('OpenSky', { status: 'error' });
      dataFreshness.recordError('opensky', String(error));
    }
  }

  /**
   * Load cached theater postures for banner display
   * Uses server-side cached data to avoid redundant calculation per user
   */
  private async loadCachedPosturesForBanner(): Promise<void> {
    try {
      const data = await fetchCachedTheaterPosture();
      if (data && data.postures.length > 0) {
        this.renderCriticalBanner(data.postures);
        // Also update posture panel with shared data (saves a duplicate fetch)
        const posturePanel = this.panels['sector-overview'] as StrategicPosturePanel | undefined;
        posturePanel?.updatePostures(data);
      }
    } catch (error) {
      console.warn('[App] Failed to load cached postures for banner:', error);
    }
  }


  private updateMonitorResults(): void {
    const monitorPanel = this.panels['monitors'] as MonitorPanel;
    monitorPanel.renderResults(this.allNews);
  }

  private async runCorrelationAnalysis(): Promise<void> {
    try {
      // Ensure we have clusters (hybrid: semantic + Jaccard when ML available)
      if (this.latestClusters.length === 0 && this.allNews.length > 0) {
        this.latestClusters = mlWorker.isAvailable
          ? await clusterNewsHybrid(this.allNews)
          : await analysisWorker.clusterNews(this.allNews);
      }

      // Ingest news clusters for risk scoring
      if (this.latestClusters.length > 0) {
        ingestNewsForRisk(this.latestClusters);
        dataFreshness.recordUpdate('gdelt', this.latestClusters.length);
        (this.panels['cri'] as CIIPanel)?.refresh();
      }

      // Run correlation analysis off main thread via Web Worker
      const signals = await analysisWorker.analyzeCorrelations(
        this.latestClusters,
        this.latestPredictions,
        this.latestMarkets
      );

      // Detect geographic convergence (suppress during learning mode)
      let geoSignals: ReturnType<typeof geoConvergenceToSignal>[] = [];
      if (!isInLearningMode()) {
        const geoAlerts = detectGeoConvergence(this.seenGeoAlerts);
        geoSignals = geoAlerts.map(geoConvergenceToSignal);
        // Push convergence notifications
        for (const alert of geoAlerts) {
          this.notificationCenter?.push({
            type: 'convergence',
            title: `Geographic Convergence`,
            body: `${alert.types.length} signal types detected near ${alert.lat.toFixed(1)}°, ${alert.lon.toFixed(1)}° (score: ${alert.score.toFixed(0)})`,
            priority: alert.score >= 8 ? 'high' : 'medium',
          });
        }
      }

      const keywordSpikeSignals = drainTrendingSignals();
      const allSignals = [...signals, ...geoSignals, ...keywordSpikeSignals];
      if (allSignals.length > 0) {
        addToSignalHistory(allSignals);
      }
    } catch (error) {
      console.error('[App] Correlation analysis failed:', error);
    }
  }

  private async loadFirmsData(): Promise<void> {
    try {
      const { regions, totalCount } = await fetchAllFires(1);
      if (totalCount > 0) {
        const flat = flattenFires(regions);
        const stats = computeRegionStats(regions);

        // Feed signal aggregator
        signalAggregator.ingestSatelliteFires(flat.map(f => ({
          lat: f.lat,
          lon: f.lon,
          brightness: f.brightness,
          frp: f.frp,
          region: f.region,
          acq_date: f.acq_date,
        })));

        // Feed map layer
        this.map?.setFires(flat);

        // Feed panel
        (this.panels['satellite-fires'] as SatelliteFiresPanel)?.update(stats, totalCount);

        dataFreshness.recordUpdate('firms', totalCount);

        // Report to temporal baseline (fire-and-forget)
        updateAndCheck([
          { type: 'satellite_fires', region: 'global', count: totalCount },
        ]).then(anomalies => {
          if (anomalies.length > 0) {
            signalAggregator.ingestTemporalAnomalies(anomalies);
          }
        }).catch(() => {});
      } else {
        // Still update panel so it exits loading spinner
        (this.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      }
      this.statusPanel?.updateApi('FIRMS', { status: 'ok' });
    } catch (e) {
      console.warn('[App] FIRMS load failed:', e);
      (this.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      this.statusPanel?.updateApi('FIRMS', { status: 'error' });
      dataFreshness.recordError('firms', String(e));
    }
  }

  private scheduleRefresh(
    name: string,
    fn: () => Promise<void>,
    intervalMs: number,
    condition?: () => boolean
  ): void {
    const HIDDEN_REFRESH_MULTIPLIER = 4;
    const JITTER_FRACTION = 0.1;
    const MIN_REFRESH_MS = 1000;
    const computeDelay = (baseMs: number, isHidden: boolean) => {
      const adjusted = baseMs * (isHidden ? HIDDEN_REFRESH_MULTIPLIER : 1);
      const jitterRange = adjusted * JITTER_FRACTION;
      const jittered = adjusted + (Math.random() * 2 - 1) * jitterRange;
      return Math.max(MIN_REFRESH_MS, Math.round(jittered));
    };
    const scheduleNext = (delay: number) => {
      if (this.isDestroyed) return;
      const timeoutId = setTimeout(run, delay);
      this.refreshTimeoutIds.set(name, timeoutId);
    };
    const run = async () => {
      if (this.isDestroyed) return;
      const isHidden = document.visibilityState === 'hidden';
      if (isHidden) {
        scheduleNext(computeDelay(intervalMs, true));
        return;
      }
      if (condition && !condition()) {
        scheduleNext(computeDelay(intervalMs, false));
        return;
      }
      if (this.inFlight.has(name)) {
        scheduleNext(computeDelay(intervalMs, false));
        return;
      }
      this.inFlight.add(name);
      try {
        await fn();
      } catch (e) {
        console.error(`[App] Refresh ${name} failed:`, e);
      } finally {
        this.inFlight.delete(name);
        scheduleNext(computeDelay(intervalMs, false));
      }
    };
    scheduleNext(computeDelay(intervalMs, document.visibilityState === 'hidden'));
  }

  private setupRefreshIntervals(): void {
    // Always refresh news, markets, predictions
    this.scheduleRefresh('news', () => this.loadNews(), REFRESH_INTERVALS.feeds);
    this.scheduleRefresh('markets', () => this.loadMarkets(), REFRESH_INTERVALS.markets);
    this.scheduleRefresh('predictions', () => this.loadPredictions(), REFRESH_INTERVALS.predictions);

    // Only refresh layer data if layer is enabled
    this.scheduleRefresh('natural', () => this.loadNatural(), 5 * 60 * 1000, () => this.mapLayers.natural);
    this.scheduleRefresh('weather', () => this.loadWeatherAlerts(), 10 * 60 * 1000, () => this.mapLayers.weather);


    // Refresh data signals for risk scoring (geopolitical variant only)
    // This handles outages, protests, tracked assets - updates map when layers enabled
    if (SITE_VARIANT === 'full') {
      this.scheduleRefresh('signals', () => {
        this.signalCache = {}; // Clear cache to force fresh fetch
        return this.loadDataSignals();
      }, 5 * 60 * 1000);
    }

    // Non-signal layer refreshes only
    // NOTE: outages, protests, tracked assets are refreshed by signal schedule above
    this.scheduleRefresh('firms', () => this.loadFirmsData(), 30 * 60 * 1000);
    this.scheduleRefresh('ais', () => this.loadAisSignals(), REFRESH_INTERVALS.ais, () => this.mapLayers.ais);
    this.scheduleRefresh('cables', () => this.loadCableActivity(), 30 * 60 * 1000, () => this.mapLayers.cables);
    this.scheduleRefresh('flights', () => this.loadFlightDelays(), 10 * 60 * 1000, () => this.mapLayers.flights);
    this.scheduleRefresh('cyberThreats', () => {
      this.securityThreatsCache = null;
      return this.loadSecurityThreats();
    }, 10 * 60 * 1000, () => CYBER_LAYER_ENABLED && this.mapLayers.cyberThreats);
  }
}
