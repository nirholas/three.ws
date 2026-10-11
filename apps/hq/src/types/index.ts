export type PropagandaRisk = 'low' | 'medium' | 'high';

export interface Feed {
  name: string;
  url: string;
  type?: string;
  region?: string;
  propagandaRisk?: PropagandaRisk;
  stateAffiliated?: string;  // e.g., "Russia", "China", "Iran"
}

import type { ThreatClassification as _TC, ThreatLevel as _TL, EventCategory as _EC } from '@/services/threat-classifier';
export type { _TC as ThreatClassification, _TL as ThreatLevel, _EC as EventCategory };
/** Rebranded alias */
export type SeverityClassification = _TC;
/** Rebranded alias */
export type SeverityLevel = _TL;

export interface NewsItem {
  source: string;
  title: string;
  link: string;
  pubDate: Date;
  isAlert: boolean;
  monitorColor?: string;
  tier?: number;
  severity?: import('@/services/threat-classifier').ThreatClassification;
  /** @deprecated Use severity */
  threat?: import('@/services/threat-classifier').ThreatClassification;
  lat?: number;
  lon?: number;
  locationName?: string;
}

export type VelocityLevel = 'normal' | 'elevated' | 'spike';
export type SentimentType = 'negative' | 'neutral' | 'positive';
export type DeviationLevel = 'normal' | 'elevated' | 'spike' | 'quiet';

export interface VelocityMetrics {
  sourcesPerHour: number;
  level: VelocityLevel;
  trend: 'rising' | 'stable' | 'falling';
  sentiment: SentimentType;
  sentimentScore: number;
}

export interface ClusteredEvent {
  id: string;
  primaryTitle: string;
  primarySource: string;
  primaryLink: string;
  sourceCount: number;
  topSources: Array<{ name: string; tier: number; url: string }>;
  allItems: NewsItem[];
  firstSeen: Date;
  lastUpdated: Date;
  isAlert: boolean;
  monitorColor?: string;
  velocity?: VelocityMetrics;
  severity?: import('@/services/threat-classifier').ThreatClassification;
  /** @deprecated Use severity */
  threat?: import('@/services/threat-classifier').ThreatClassification;
  lat?: number;
  lon?: number;
}

export type AssetType = 'pipeline' | 'cable' | 'datacenter' | 'facility' | 'energy';

export interface RelatedAsset {
  id: string;
  name: string;
  type: AssetType;
  distanceKm: number;
}

export interface RelatedAssetContext {
  origin: { label: string; lat: number; lon: number };
  types: AssetType[];
  assets: RelatedAsset[];
}

export interface Sector {
  symbol: string;
  name: string;
}

export interface Commodity {
  symbol: string;
  name: string;
  display: string;
}

export interface MarketSymbol {
  symbol: string;
  name: string;
  display: string;
}

export interface MarketData {
  symbol: string;
  name: string;
  display: string;
  price: number | null;
  change: number | null;
  sparkline?: number[];
}

export interface CryptoData {
  name: string;
  symbol: string;
  price: number;
  change: number;
  sparkline?: number[];
}

/** Real-time price update from Binance WebSocket */
export interface PriceUpdate {
  symbol: string;           // 'BTC', 'ETH', etc.
  pair: string;             // 'BTCUSDT'
  price: number;
  change24h: number;        // Percent
  changeAbsolute: number;   // USD
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export type TrendDirection = 'escalating' | 'stable' | 'de-escalating';
/** @deprecated Use TrendDirection */
export type EscalationTrend = TrendDirection;

export interface DynamicTrendScore {
  hotspotId: string;
  staticBaseline: number;
  dynamicScore: number;
  combinedScore: number;
  trend: TrendDirection;
  components: {
    newsActivity: number;
    riskContribution: number;
    geoConvergence: number;
    whaleActivity: number;
  };
  history: Array<{ timestamp: number; score: number }>;
  lastUpdated: Date;
}
/** @deprecated Use DynamicTrendScore */
export type DynamicEscalationScore = DynamicTrendScore;

export interface HistoricalContext {
  lastMajorEvent?: string;
  lastMajorEventDate?: string;
  precedentCount?: number;
  precedentDescription?: string;
  cyclicalRisk?: string;
}

export interface Hotspot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  keywords: string[];
  subtext?: string;
  location?: string;  // Human-readable location (e.g., "Sahel Region, West Africa")
  agencies?: string[];
  level?: 'low' | 'elevated' | 'high';
  description?: string;
  status?: string;
  // Trend indicators
  trendScore?: 1 | 2 | 3 | 4 | 5;
  /** @deprecated Use trendScore */
  escalationScore?: 1 | 2 | 3 | 4 | 5;
  trendDirection?: TrendDirection;
  /** @deprecated Use trendDirection */
  escalationTrend?: TrendDirection;
  trendIndicators?: string[];
  /** @deprecated Use trendIndicators */
  escalationIndicators?: string[];
  // Historical context (Quick Win #4)
  history?: HistoricalContext;
  whyItMatters?: string;
}

export interface KeyWaterway {
  id: string;
  name: string;
  lat: number;
  lon: number;
  description?: string;
}
/** @deprecated Use KeyWaterway */
export type StrategicWaterway = KeyWaterway;

export type AisDisruptionType = 'gap_spike' | 'chokepoint_congestion';

export interface AisDisruptionEvent {
  id: string;
  name: string;
  type: AisDisruptionType;
  lat: number;
  lon: number;
  severity: 'low' | 'elevated' | 'high';
  changePct: number;
  windowHours: number;
  darkShips?: number;
  vesselCount?: number;
  region?: string;
  description: string;
}

export interface AisDensityZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  intensity: number;
  deltaPct: number;
  shipsPerDay?: number;
  note?: string;
}

export interface APTGroup {
  id: string;
  name: string;
  aka: string;
  sponsor: string;
  lat: number;
  lon: number;
}

export type SecurityThreatType = 'c2_server' | 'malware_host' | 'phishing' | 'malicious_url';
/** @deprecated Use SecurityThreatType */
export type CyberThreatType = SecurityThreatType;
export type SecurityThreatSource = 'feodo' | 'urlhaus' | 'c2intel' | 'otx' | 'abuseipdb';
/** @deprecated Use SecurityThreatSource */
export type CyberThreatSource = SecurityThreatSource;
export type SecurityThreatSeverity = 'low' | 'medium' | 'high' | 'critical';
/** @deprecated Use SecurityThreatSeverity */
export type CyberThreatSeverity = SecurityThreatSeverity;
export type SecurityThreatIndicatorType = 'ip' | 'domain' | 'url';
/** @deprecated Use SecurityThreatIndicatorType */
export type CyberThreatIndicatorType = SecurityThreatIndicatorType;

export interface SecurityThreat {
  id: string;
  type: SecurityThreatType;
  source: SecurityThreatSource;
  indicator: string;
  indicatorType: SecurityThreatIndicatorType;
  lat: number;
  lon: number;
  country?: string;
  severity: SecurityThreatSeverity;
  malwareFamily?: string;
  tags: string[];
  firstSeen?: string;
  lastSeen?: string;
}
/** @deprecated Use SecurityThreat */
export type CyberThreat = SecurityThreat;

export interface RiskRegion {
  id: string;
  name: string;
  coords: [number, number][];
  center: [number, number];
  intensity?: 'high' | 'medium' | 'low';
  parties?: string[];
  casualties?: string;
  displaced?: string;
  keywords?: string[];
  startDate?: string;
  location?: string;
  description?: string;
  keyDevelopments?: string[];
}
/** @deprecated Use RiskRegion */
export type ConflictZone = RiskRegion;

// UCDP Georeferenced Events
export type UcdpEventType = 'state-based' | 'non-state' | 'one-sided';

export interface UcdpGeoEvent {
  id: string;
  date_start: string;
  date_end: string;
  latitude: number;
  longitude: number;
  country: string;
  side_a: string;
  side_b: string;
  deaths_best: number;
  deaths_low: number;
  deaths_high: number;
  type_of_violence: UcdpEventType;
  source_original: string;
}

// UNHCR Displacement Data
export interface DisplacementFlow {
  originCode: string;
  originName: string;
  asylumCode: string;
  asylumName: string;
  refugees: number;
  originLat?: number;
  originLon?: number;
  asylumLat?: number;
  asylumLon?: number;
}

export interface CountryDisplacement {
  code: string;
  name: string;
  // Origin-country displacement outflow metrics
  refugees: number;
  asylumSeekers: number;
  idps: number;
  stateless: number;
  totalDisplaced: number;
  // Host-country intake metrics
  hostRefugees: number;
  hostAsylumSeekers: number;
  hostTotal: number;
  lat?: number;
  lon?: number;
}

export interface UnhcrSummary {
  year: number;
  globalTotals: {
    refugees: number;
    asylumSeekers: number;
    idps: number;
    stateless: number;
    total: number;
  };
  countries: CountryDisplacement[];
  topFlows: DisplacementFlow[];
}

// Climate Anomaly Data (Open-Meteo / ERA5)
export type AnomalySeverity = 'normal' | 'moderate' | 'extreme';

export interface ClimateAnomaly {
  zone: string;
  lat: number;
  lon: number;
  tempDelta: number;
  precipDelta: number;
  severity: AnomalySeverity;
  type: 'warm' | 'cold' | 'wet' | 'dry' | 'mixed';
  period: string;
}

// WorldPop Population Exposure
export interface CountryPopulation {
  code: string;
  name: string;
  population: number;
  densityPerKm2: number;
}

export interface PopulationExposure {
  eventId: string;
  eventName: string;
  eventType: string;
  lat: number;
  lon: number;
  exposedPopulation: number;
  exposureRadiusKm: number;
}

// Tracked facility operator types
export type FacilityOperatorType =
  | 'us-nato'      // United States and NATO allies
  | 'china'        // People's Republic of China
  | 'russia'       // Russian Federation
  | 'uk'           // United Kingdom (non-US NATO)
  | 'france'       // France (non-US NATO)
  | 'india'        // India
  | 'italy'        // Italy
  | 'uae'          // United Arab Emirates
  | 'turkey'       // Turkey
  | 'japan'        // Japan Self-Defense Forces
  | 'other';       // Other nations
/** @deprecated Use FacilityOperatorType */
export type MilitaryBaseType = FacilityOperatorType;

export interface TrackedFacility {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: FacilityOperatorType;
  description?: string;
  country?: string;           // Host country
  arm?: string;               // Branch
  status?: 'active' | 'planned' | 'controversial' | 'closed';
  source?: string;            // Reference URL
}
/** @deprecated Use TrackedFacility */
export type MilitaryBase = TrackedFacility;

export interface CableLandingPoint {
  country: string;       // ISO code
  countryName: string;
  city?: string;
  lat: number;
  lon: number;
}

export interface CountryCapacity {
  country: string;       // ISO code
  capacityShare: number; // 0-1, what % of country's int'l capacity
  isRedundant: boolean;  // Has alternative routes
}

export interface UnderseaCable {
  id: string;
  name: string;
  points: [number, number][];
  major?: boolean;
  // Enhanced fields for cascade analysis
  landingPoints?: CableLandingPoint[];
  countriesServed?: CountryCapacity[];
  capacityTbps?: number;
  rfsYear?: number;      // Ready for service year
  owners?: string[];
}

export type CableAdvisorySeverity = 'fault' | 'degraded';

export interface CableAdvisory {
  id: string;
  cableId: string;
  title: string;
  severity: CableAdvisorySeverity;
  description: string;
  reported: Date;
  lat: number;
  lon: number;
  impact: string;
  repairEta?: string;
}

export type RepairShipStatus = 'enroute' | 'on-station';

export interface RepairShip {
  id: string;
  name: string;
  cableId: string;
  status: RepairShipStatus;
  lat: number;
  lon: number;
  eta: string;
  operator?: string;
  note?: string;
}

export interface ShippingChokepoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  desc: string;
}

export interface CyberRegion {
  id: string;
  group: string;
  aka: string;
  sponsor: string;
}

// Energy facility types
export type EnergyFacilityType =
  | 'plant'        // Power reactors
  | 'enrichment'   // Uranium enrichment
  | 'reprocessing' // Plutonium reprocessing
  | 'weapons'      // Weapons design/assembly
  | 'ssbn'         // Submarine base
  | 'test-site'    // Test site
  | 'icbm'         // Silo fields
  | 'research';    // Research reactors
/** @deprecated Use EnergyFacilityType */
export type NuclearFacilityType = EnergyFacilityType;

export interface EnergyFacility {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: EnergyFacilityType;
  status: 'active' | 'contested' | 'inactive' | 'decommissioned' | 'construction';
  operator?: string;  // Operating country
}
/** @deprecated Use EnergyFacility */
export type NuclearFacility = EnergyFacility;

export interface GammaIrradiator {
  id: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  organization?: string;
}

export type PipelineType = 'oil' | 'gas' | 'products';
export type PipelineStatus = 'operating' | 'construction';

export interface PipelineTerminal {
  country: string;       // ISO code
  name?: string;         // Terminal/field name
  portId?: string;       // Link to port if applicable
  lat?: number;
  lon?: number;
}

export interface Pipeline {
  id: string;
  name: string;
  type: PipelineType;
  status: PipelineStatus;
  points: [number, number][];  // [lon, lat] pairs
  capacity?: string;           // e.g., "1.2 million bpd"
  length?: string;             // e.g., "1,768 km"
  operator?: string;
  countries?: string[];
  // Enhanced fields for cascade analysis
  origin?: PipelineTerminal;
  destination?: PipelineTerminal;
  transitCountries?: string[];   // ISO codes
  capacityMbpd?: number;         // Million barrels per day (oil)
  capacityBcmY?: number;         // Billion cubic meters/year (gas)
  alternatives?: string[];       // Pipeline IDs that could substitute
}

export interface Earthquake {
  id: string;
  place: string;
  magnitude: number;
  lat: number;
  lon: number;
  depth: number;
  time: Date;
  url: string;
}

export interface Monitor {
  id: string;
  keywords: string[];
  color: string;
  name?: string;
  lat?: number;
  lon?: number;
}

export interface PanelConfig {
  name: string;
  enabled: boolean;
  priority?: number;
}

export interface MapLayers {
  conflicts: boolean;
  bases: boolean;
  cables: boolean;
  pipelines: boolean;
  hotspots: boolean;
  ais: boolean;
  nuclear: boolean;
  irradiators: boolean;
  sanctions: boolean;
  weather: boolean;
  economic: boolean;
  waterways: boolean;
  outages: boolean;
  cyberThreats: boolean;
  datacenters: boolean;
  protests: boolean;
  flights: boolean;
  military: boolean;
  natural: boolean;
  spaceports: boolean;
  minerals: boolean;
  fires: boolean;
  // Data source layers
  ucdpEvents: boolean;
  displacement: boolean;
  climate: boolean;
  // DeFi globe layers
  exchangeMap: boolean;
  // DeFi globe layers
  tvlHeatmap: boolean;
  chainFlows: boolean;
  // Tech variant layers
  startupHubs: boolean;
  cloudRegions: boolean;
  accelerators: boolean;
  techHQs: boolean;
  techEvents: boolean;
  // DeFi layers
  whaleActivity: boolean;
  validatorNodes: boolean;
}

export interface AIDataCenter {
  id: string;
  name: string;
  owner: string;
  country: string;
  lat: number;
  lon: number;
  status: 'existing' | 'planned' | 'decommissioned';
  chipType: string;
  chipCount: number;
  powerMW?: number;
  h100Equivalent?: number;
  sector?: string;
  note?: string;
}

export interface InternetOutage {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  country: string;
  region?: string;
  lat: number;
  lon: number;
  severity: 'partial' | 'major' | 'total';
  categories: string[];
  cause?: string;
  outageType?: string;
  endDate?: Date;
}

export type EconomicCenterType = 'exchange' | 'central-bank' | 'financial-hub';

export interface EconomicCenter {
  id: string;
  name: string;
  type: EconomicCenterType;
  lat: number;
  lon: number;
  country: string;
  marketHours?: { open: string; close: string; timezone: string };
  description?: string;
}

export interface Spaceport {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  operator: string;
  status: 'active' | 'construction' | 'inactive';
  launches: 'High' | 'Medium' | 'Low';
}

export interface CriticalMineralProject {
  id: string;
  name: string;
  lat: number;
  lon: number;
  mineral: string;
  country: string;
  operator: string;
  status: 'producing' | 'development' | 'exploration';
  significance: string;
}

export interface PredictionMarket {
  title: string;
  yesPrice: number;
  volume?: number;
  url?: string;
}

export interface AppState {
  currentView: 'global' | 'us';
  mapZoom: number;
  mapPan: { x: number; y: number };
  mapLayers: MapLayers;
  panels: Record<string, PanelConfig>;
  monitors: Monitor[];
  allNews: NewsItem[];
  isLoading: boolean;
}

export type FeedCategory = 'politics' | 'tech' | 'finance' | 'gov' | 'intel';

// Social Unrest / Protest Types
export type ProtestSeverity = 'low' | 'medium' | 'high';
export type ProtestSource = 'acled' | 'gdelt' | 'rss';
export type ProtestEventType = 'protest' | 'riot' | 'strike' | 'demonstration' | 'civil_unrest';

export interface SocialUnrestEvent {
  id: string;
  title: string;
  summary?: string;
  eventType: ProtestEventType;
  city?: string;
  country: string;
  region?: string;
  lat: number;
  lon: number;
  time: Date;
  severity: ProtestSeverity;
  fatalities?: number;
  sources: string[];
  sourceType: ProtestSource;
  tags?: string[];
  actors?: string[];
  relatedHotspots?: string[];
  confidence: 'high' | 'medium' | 'low';
  validated: boolean;
  imageUrl?: string;
  sentiment?: 'angry' | 'peaceful' | 'mixed';
}

export interface ProtestCluster {
  id: string;
  country: string;
  region?: string;
  eventCount: number;
  events: SocialUnrestEvent[];
  severity: ProtestSeverity;
  startDate: Date;
  endDate: Date;
  primaryCause?: string;
}

// Flight Delay Types
export type FlightDelaySource = 'faa' | 'eurocontrol' | 'computed';
export type FlightDelaySeverity = 'normal' | 'minor' | 'moderate' | 'major' | 'severe';
export type FlightDelayType = 'ground_stop' | 'ground_delay' | 'departure_delay' | 'arrival_delay' | 'general';
export type AirportRegion = 'americas' | 'europe' | 'apac' | 'mena' | 'africa';

export interface AirportDelayAlert {
  id: string;
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  region: AirportRegion;
  delayType: FlightDelayType;
  severity: FlightDelaySeverity;
  avgDelayMinutes: number;
  delayedFlightsPct?: number;
  cancelledFlights?: number;
  totalFlights?: number;
  reason?: string;
  source: FlightDelaySource;
  updatedAt: Date;
}

export interface MonitoredAirport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  region: AirportRegion;
}

// Flight Tracking Types
export type AircraftCategory =
  | 'fighter'           // F-15, F-16, F-22, F-35, Su-27, etc.
  | 'bomber'            // B-52, B-1, B-2, Tu-95, etc.
  | 'transport'         // C-130, C-17, Il-76, A400M, etc.
  | 'tanker'            // KC-135, KC-10, KC-46, etc.
  | 'awacs'             // E-3, E-7, A-50, etc.
  | 'reconnaissance'    // RC-135, U-2, EP-3, etc.
  | 'helicopter'        // UH-60, CH-47, Mi-8, etc.
  | 'drone'             // RQ-4, MQ-9, etc.
  | 'patrol'            // P-8, P-3, etc.
  | 'special_ops'       // MC-130, CV-22, etc.
  | 'vip'               // Government/executive transport
  | 'unknown';
/** @deprecated Use AircraftCategory */
export type MilitaryAircraftType = AircraftCategory;

export type FleetOperator =
  | 'usaf'              // US Air Force
  | 'usn'               // US Navy
  | 'usmc'              // US Marine Corps
  | 'usa'               // US Army
  | 'raf'               // Royal Air Force (UK)
  | 'rn'                // Royal Navy (UK)
  | 'faf'               // French Air Force
  | 'gaf'               // German Air Force
  | 'plaaf'             // PLA Air Force (China)
  | 'plan'              // PLA Navy (China)
  | 'vks'               // Russian Aerospace Forces
  | 'iaf'               // Israeli Air Force
  | 'nato'              // NATO joint operations
  | 'other';
/** @deprecated Use FleetOperator */
export type MilitaryOperator = FleetOperator;

export interface TrackedFlight {
  id: string;
  callsign: string;
  hexCode: string;             // ICAO 24-bit address
  registration?: string;
  aircraftType: AircraftCategory;
  aircraftModel?: string;      // E.g., "F-35A", "C-17A"
  operator: FleetOperator;
  operatorCountry: string;
  lat: number;
  lon: number;
  altitude: number;            // feet
  heading: number;             // degrees
  speed: number;               // knots
  verticalRate?: number;       // feet/min
  onGround: boolean;
  squawk?: string;             // Transponder code
  origin?: string;             // ICAO airport code
  destination?: string;        // ICAO airport code
  lastSeen: Date;
  firstSeen?: Date;
  track?: [number, number][];  // Historical positions for trail
  confidence: 'high' | 'medium' | 'low';
  isInteresting?: boolean;     // Flagged for unusual activity
  note?: string;
  // Wingbits enrichment data
  enriched?: {
    manufacturer?: string;
    owner?: string;
    operatorName?: string;
    typeCode?: string;
    builtYear?: string;
    confirmedTracked?: boolean;
    fleetBranch?: string;
  };
}
/** @deprecated Use TrackedFlight */
export type MilitaryFlight = TrackedFlight;

export interface FlightCluster {
  id: string;
  name: string;
  lat: number;
  lon: number;
  flightCount: number;
  flights: TrackedFlight[];
  dominantOperator?: FleetOperator;
  activityType?: 'exercise' | 'patrol' | 'transport' | 'unknown';
}
/** @deprecated Use FlightCluster */
export type MilitaryFlightCluster = FlightCluster;

// Special Vessel Tracking Types
export type VesselCategory =
  | 'carrier'           // Aircraft carrier
  | 'destroyer'         // Destroyer/Cruiser
  | 'frigate'           // Frigate/Corvette
  | 'submarine'         // Submarine (when surfaced/detected)
  | 'amphibious'        // LHD, LPD, LST
  | 'patrol'            // Coast guard, patrol boats
  | 'auxiliary'         // Supply ships, tankers
  | 'research'          // Research vessels
  | 'icebreaker'        // Icebreakers
  | 'special'           // Special mission vessels
  | 'unknown';
/** @deprecated Use VesselCategory */
export type MilitaryVesselType = VesselCategory;

export interface TrackedVessel {
  id: string;
  mmsi: string;
  name: string;
  vesselType: VesselCategory;
  aisShipType?: string;        // Human-readable AIS ship type (Cargo, Tanker, etc.)
  hullNumber?: string;         // E.g., "DDG-51", "CVN-78"
  operator: FleetOperator | 'other';
  operatorCountry: string;
  lat: number;
  lon: number;
  heading: number;
  speed: number;               // knots
  course?: number;
  destination?: string;
  lastAisUpdate: Date;
  aisGapMinutes?: number;      // Time since last AIS signal
  isDark?: boolean;            // AIS disabled/suspicious
  nearChokepoint?: string;     // If near key waterway
  nearBase?: string;           // If near known facility
  track?: [number, number][];  // Historical positions
  confidence: 'high' | 'medium' | 'low';
  isInteresting?: boolean;
  note?: string;
}
/** @deprecated Use TrackedVessel */
export type MilitaryVessel = TrackedVessel;

export interface VesselCluster {
  id: string;
  name: string;
  lat: number;
  lon: number;
  vesselCount: number;
  vessels: TrackedVessel[];
  region?: string;
  activityType?: 'exercise' | 'deployment' | 'transit' | 'unknown';
}
/** @deprecated Use VesselCluster */
export type MilitaryVesselCluster = VesselCluster;

// Combined activity summary
export interface ActivitySummary {
  flights: TrackedFlight[];
  vessels: TrackedVessel[];
  flightClusters: FlightCluster[];
  vesselClusters: VesselCluster[];
  activeOperations: number;
  lastUpdate: Date;
}
/** @deprecated Use ActivitySummary */
export type MilitaryActivitySummary = ActivitySummary;

// GDELT Country Tension Pairs
export interface GdeltTensionPair {
  id: string;
  countries: [string, string];
  label: string;
  score: number;
  trend: 'rising' | 'stable' | 'falling';
  changePercent: number;
  region: string;
}

// NASA EONET Natural Events
export type NaturalEventCategory =
  | 'severeStorms'
  | 'wildfires'
  | 'volcanoes'
  | 'earthquakes'
  | 'floods'
  | 'landslides'
  | 'drought'
  | 'dustHaze'
  | 'snow'
  | 'tempExtremes'
  | 'seaLakeIce'
  | 'waterColor'
  | 'manmade';

export interface NaturalEvent {
  id: string;
  title: string;
  description?: string;
  category: NaturalEventCategory;
  categoryTitle: string;
  lat: number;
  lon: number;
  date: Date;
  magnitude?: number;
  magnitudeUnit?: string;
  sourceUrl?: string;
  sourceName?: string;
  closed: boolean;
}

// Infrastructure Cascade Types
export type InfrastructureNodeType = 'cable' | 'pipeline' | 'port' | 'chokepoint' | 'country' | 'route';

export interface InfrastructureNode {
  id: string;
  type: InfrastructureNodeType;
  name: string;
  coordinates?: [number, number];
  metadata?: Record<string, unknown>;
}

export type DependencyType =
  | 'serves'              // Infrastructure serves country
  | 'terminates_at'       // Pipeline terminates at port
  | 'transits_through'    // Route transits chokepoint
  | 'lands_at'            // Cable lands at country
  | 'depends_on'          // Port depends on pipeline
  | 'shares_risk'         // Assets share vulnerability
  | 'alternative_to'      // Provides redundancy
  | 'trade_route'         // Port enables trade route
  | 'controls_access'     // Chokepoint controls access
  | 'trade_dependency';   // Country depends on trade route

export interface DependencyEdge {
  from: string;           // Node ID
  to: string;             // Node ID
  type: DependencyType;
  strength: number;       // 0-1 criticality
  redundancy?: number;    // 0-1 how replaceable
  metadata?: {
    capacityShare?: number;
    alternativeRoutes?: number;
    estimatedImpact?: string;
    portType?: string;
    relationship?: string;
  };
}

export type CascadeImpactLevel = 'critical' | 'high' | 'medium' | 'low';

export interface CascadeAffectedNode {
  node: InfrastructureNode;
  impactLevel: CascadeImpactLevel;
  pathLength: number;
  dependencyChain: string[];
  redundancyAvailable: boolean;
  estimatedRecovery?: string;
}

export interface CascadeCountryImpact {
  country: string;
  countryName: string;
  impactLevel: CascadeImpactLevel;
  affectedCapacity: number;
  criticalSectors?: string[];
}

export interface CascadeResult {
  source: InfrastructureNode;
  affectedNodes: CascadeAffectedNode[];
  countriesAffected: CascadeCountryImpact[];
  economicImpact?: {
    dailyTradeLoss?: number;
    affectedThroughput?: number;
  };
  redundancies?: {
    id: string;
    name: string;
    capacityShare: number;
  }[];
}

// Re-export port types
export type { Port, PortType } from '@/config/ports';

// AI Regulation Types
export type RegulationType = 'comprehensive' | 'sectoral' | 'voluntary' | 'proposed';
export type ComplianceStatus = 'active' | 'proposed' | 'draft' | 'superseded';
export type RegulationStance = 'strict' | 'moderate' | 'permissive' | 'undefined';

export interface AIRegulation {
  id: string;
  name: string;
  shortName: string;
  country: string;
  region?: string;
  type: RegulationType;
  status: ComplianceStatus;
  announcedDate: string;
  effectiveDate?: string;
  complianceDeadline?: string;
  scope: string[];
  keyProvisions: string[];
  penalties?: string;
  link?: string;
  description?: string;
}

export interface RegulatoryAction {
  id: string;
  date: string;
  country: string;
  title: string;
  type: 'law-passed' | 'executive-order' | 'guideline' | 'enforcement' | 'consultation';
  regulationId?: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  source?: string;
}

export interface CountryRegulationProfile {
  country: string;
  countryCode: string;
  stance: RegulationStance;
  activeRegulations: string[];
  proposedRegulations: string[];
  lastUpdated: string;
  summary: string;
}

// Tech Company & AI Lab Types
export interface TechCompany {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  city?: string;
  sector?: string;
  officeType?: 'headquarters' | 'regional' | 'engineering' | 'research' | 'campus' | 'major office';
  employees?: number;
  foundedYear?: number;
  keyProducts?: string[];
  valuation?: number;
  stockSymbol?: string;
  description?: string;
}

export interface AIResearchLab {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  city?: string;
  type: 'corporate' | 'academic' | 'government' | 'nonprofit' | 'industry' | 'research institute';
  parent?: string;
  focusAreas?: string[];
  description?: string;
  foundedYear?: number;
  notableWork?: string[];
  publications?: number;
  faculty?: number;
}

export interface StartupEcosystem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  city: string;
  ecosystemTier?: 'tier1' | 'tier2' | 'tier3' | 'emerging';
  totalFunding2024?: number;
  activeStartups?: number;
  unicorns?: number;
  topSectors?: string[];
  majorVCs?: string[];
  notableStartups?: string[];
  avgSeedRound?: number;
  avgSeriesA?: number;
  description?: string;
}

// ============================================================================
// FOCAL POINT DETECTION (Cross-Signal Synthesis)
// ============================================================================

export type FocalPointUrgency = 'watch' | 'elevated' | 'critical';

export interface HeadlineWithUrl {
  title: string;
  url: string;
}

export interface EntityMention {
  entityId: string;
  entityType: 'country' | 'company' | 'index' | 'commodity' | 'crypto' | 'sector';
  displayName: string;
  mentionCount: number;
  avgConfidence: number;
  clusterIds: string[];
  topHeadlines: HeadlineWithUrl[];
}

export interface FocalPoint {
  id: string;
  entityId: string;
  entityType: 'country' | 'company' | 'index' | 'commodity' | 'crypto' | 'sector';
  displayName: string;

  // News dimension
  newsMentions: number;
  newsVelocity: number;
  topHeadlines: HeadlineWithUrl[];

  // Signal dimension
  signalTypes: string[];
  signalCount: number;
  highSeverityCount: number;
  signalDescriptions: string[];

  // Scoring
  focalScore: number;
  urgency: FocalPointUrgency;

  // For AI context
  narrative: string;
  correlationEvidence: string[];
}

export interface FocalPointSummary {
  timestamp: Date;
  focalPoints: FocalPoint[];
  aiContext: string;
  topCountries: FocalPoint[];
  topCompanies: FocalPoint[];
}

export interface MapProtestCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  items: SocialUnrestEvent[];
  country: string;
  maxSeverity: 'low' | 'medium' | 'high';
  hasRiot: boolean;
  latestRiotEventTimeMs?: number;
  totalFatalities: number;
  riotCount?: number;
  highSeverityCount?: number;
  verifiedCount?: number;
  sampled?: boolean;
}

export interface MapTechHQCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  items: import('@/config/tech-geo').TechHQ[];
  city: string;
  country: string;
  primaryType: 'faang' | 'unicorn' | 'public';
  faangCount?: number;
  unicornCount?: number;
  publicCount?: number;
  sampled?: boolean;
}

export interface MapTechEventCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  items: Array<{ id: string; title: string; location: string; lat: number; lng: number; country: string; startDate: string; endDate: string; url: string | null; daysUntil: number }>;
  location: string;
  country: string;
  soonestDaysUntil: number;
  soonCount?: number;
  sampled?: boolean;
}

export interface MapDatacenterCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  items: AIDataCenter[];
  region: string;
  country: string;
  totalChips: number;
  totalPowerMW: number;
  majorityExisting: boolean;
  existingCount?: number;
  plannedCount?: number;
  sampled?: boolean;
}

/* ── Crypto News Types ── */
export type CryptoNewsCategory =
  | 'bitcoin' | 'defi' | 'ethereum' | 'solana' | 'altcoins'
  | 'regulation' | 'security' | 'research' | 'institutional' | 'general';

export type TrendingSentiment = 'bullish' | 'bearish' | 'neutral';

export interface CryptoNewsArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  category: CryptoNewsCategory;
  timeAgo: string;
}

export interface CryptoNewsResponse {
  articles: CryptoNewsArticle[];
  totalCount: number;
  sources: string[];
  fetchedAt: string;
  breaking: boolean;
}

export interface TrendingTopic {
  topic: string;
  count: number;
  sentiment: TrendingSentiment;
  sampleHeadlines: string[];
}

export interface CryptoTrendingResponse {
  trending: TrendingTopic[];
  totalArticlesAnalyzed: number;
  timeWindow: string;
  fetchedAt: string;
}

/* ── $THREE signal types (three.ws /api/three-signal) ── */
export type ThreeSignalLabel = string;

export interface ThreeSignalLatest {
  price_usd: number | null;
  change_24h: number | null;
  market_cap_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  signal: ThreeSignalLabel | null;
  headline: string | null;
  confidence: number | null;
  ts: number | string | null;
}

export interface ThreeSignalPoint {
  ts: number | string;
  price_usd: number | null;
  change_24h: number | null;
  signal: ThreeSignalLabel | null;
}

export interface ThreeSignalResponse {
  latest: ThreeSignalLatest | null;
  history: ThreeSignalPoint[];
  stale: boolean;
  age_seconds: number | null;
}

/* ── On-Chain Subgraph Types ── */
export interface UniswapPool {
  id: string;
  pair: string;
  token0: { symbol: string; name: string };
  token1: { symbol: string; name: string };
  feeTier: number;
  feeTierDisplay: string;
  tvl: number;
  volume24h: number;
  price: number;
  txCount: number;
  utilization: number;
}

export interface UniswapSubgraphResult {
  timestamp: string;
  pools: UniswapPool[];
  summary: {
    totalTvl: number;
    totalVolume24h: number;
    poolCount: number;
    topPair: string;
    avgUtilization: number;
  };
  unavailable?: boolean;
}

export interface AaveLendingMarket {
  symbol: string;
  name: string;
  totalSupplied: number;
  totalBorrowed: number;
  available: number;
  supplyAPY: number;
  borrowAPY: number;
  stableBorrowAPY: number;
  utilization: number;
  tvlUSD: number;
}

export interface AaveSubgraphResult {
  timestamp: string;
  markets: AaveLendingMarket[];
  summary: {
    totalTvl: number;
    totalBorrowed: number;
    avgUtilization: number;
    topMarket: string;
    marketCount: number;
  };
  unavailable?: boolean;
}

export interface CompoundMarket {
  symbol: string;
  name: string;
  totalSupplied: number;
  totalBorrowed: number;
  supplyAPY: number;
  borrowAPY: number;
  utilization: number;
  collateralFactor: number;
  tvlUSD: number;
}

export interface CompoundSubgraphResult {
  timestamp: string;
  markets: CompoundMarket[];
  summary: {
    totalTvl: number;
    totalBorrowed: number;
    avgUtilization: number;
    topMarket: string;
    marketCount: number;
  };
  unavailable?: boolean;
}

/* ── Whale Monitor Types ── */
export interface WhaleTransaction {
  hash: string;
  chain: string;
  from: { address: string; label: string; type: string };
  to: { address: string; label: string; type: string };
  value: number;
  valueUSD: number;
  token: string;
  type: 'exchange_deposit' | 'exchange_withdrawal' | 'whale_transfer' | 'bridge_deposit' | 'unknown';
  blockNumber: number;
  timestamp: string;
  significance: 'high' | 'medium' | 'low';
}

export interface WhaleAlert {
  type: string;
  message: string;
  significance: string;
  timestamp: string;
  hash: string;
}

export interface WhaleMonitorResult {
  timestamp: string;
  transactions: WhaleTransaction[];
  summary: {
    totalVolume1h: number;
    exchangeInflows: number;
    exchangeOutflows: number;
    netExchangeFlow: number;
    largestTx: { hash: string; valueUSD: number };
    alertCount: number;
    txCount: number;
  };
  alerts: WhaleAlert[];
  unavailable?: boolean;
}

/** Globe layer data point for whale activity visualization */
export interface WhaleActivityPoint {
  entity: string;
  lat: number;
  lon: number;
  inflowUSD: number;
  outflowUSD: number;
  txCount: number;
  lastActivity: string;
}

/* ── Bridge Monitor Types ── */
export interface BridgeData {
  id: number;
  name: string;
  displayName: string;
  icon: string;
  chains: string[];
  volume24h: number;
  volume7d: number;
  volumeChange24h: number;
  currentDayDeposits: number;
  currentDayWithdrawals: number;
  netFlow: number;
  netFlowDirection: 'inflow' | 'outflow' | 'balanced';
  txCount24h: number;
  status: 'healthy' | 'degraded' | 'down';
}

export interface BridgeChainSummary {
  chain: string;
  totalDeposits24h: number;
  totalWithdrawals24h: number;
  netFlow: number;
  activeBridges: number;
}

export interface BridgeAlert {
  type: 'high-volume' | 'net-outflow' | 'imbalance';
  bridge: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
}

export interface BridgeMonitorResult {
  timestamp: string;
  bridges: BridgeData[];
  chainSummary: BridgeChainSummary[];
  alerts: BridgeAlert[];
  summary: {
    totalVolume24h: number;
    totalVolume7d: number;
    activeBridges: number;
    largestBridge: string;
    biggestNetInflow: { chain: string; amount: number };
    biggestNetOutflow: { chain: string; amount: number };
  };
  unavailable?: boolean;
}

/* ── Governance & DAO Types ── */
export interface GovernanceProposal {
  id: string;
  title: string;
  space: { id: string; name: string; avatar: string };
  state: 'active' | 'closed' | 'pending';
  choices: string[];
  scores: number[];
  scoresTotal: number;
  votes: number;
  quorum: number;
  quorumReached: boolean;
  type: string;
  startDate: string;
  endDate: string;
  timeLeft: string;
  link: string;
  result?: string;
}

export interface GovernanceResult {
  timestamp: string;
  active: GovernanceProposal[];
  recent: GovernanceProposal[];
  spaces: Array<{ id: string; name: string; activeCount: number; memberCount: number }>;
  summary: {
    activeProposals: number;
    spacesTracked: number;
    totalVotesActive: number;
    highestParticipation: { space: string; votes: number };
  };
  unavailable?: boolean;
}

/* ── Lending Rate Comparison Types ── */

export interface LendingRate {
  protocol: string;
  chain: string;
  supplyAPY: number;
  borrowAPY: number;
  rewardAPY: number;
  netSupplyAPY: number;
  netBorrowAPY: number;
  tvl: number;
  utilization: number;
  poolId: string;
}

export interface LendingAsset {
  symbol: string;
  name: string;
  rates: LendingRate[];
  bestSupply: { protocol: string; apy: number; chain: string };
  bestBorrow: { protocol: string; apy: number; chain: string };
  spread: number;
}

export interface LendingRatesResult {
  timestamp: string;
  assets: LendingAsset[];
  protocols: string[];
  summary: {
    avgSupplyAPY: number;
    avgBorrowAPY: number;
    bestOverallSupply: { asset: string; protocol: string; apy: number } | null;
    lowestBorrow: { asset: string; protocol: string; apy: number } | null;
    assetCount: number;
  };
  unavailable?: boolean;
}

/* ── Token Unlock & Vesting Types ── */
export interface TokenUnlock {
  token: string;
  symbol: string;
  date: string;
  daysUntil: number;
  amount: number;
  percentOfSupply: number;
  valueUSD: number;
  recipient: string;
  cliff: boolean;
  currentPrice: number;
  priceImpactRisk: 'high' | 'medium' | 'low';
  category: string;
}

export interface TokenUnlocksResult {
  timestamp: string;
  upcoming: TokenUnlock[];
  calendar: {
    thisWeek: TokenUnlock[];
    nextWeek: TokenUnlock[];
    thisMonth: TokenUnlock[];
    next90Days: TokenUnlock[];
  };
  summary: {
    totalValueNext7d: number;
    totalValueNext30d: number;
    highestImpact: { token: string; percentOfSupply: number };
    upcomingCount: number;
  };
  unavailable?: boolean;
}

/* ── Airdrop Tracker Types ── */
export type AirdropStatus = 'upcoming' | 'claimable' | 'ended' | 'rumored';

export interface Airdrop {
  id: string;
  protocol: string;
  token: string;
  symbol: string;
  chain: string;
  status: AirdropStatus;
  description: string;
  claimUrl?: string;
  claimDeadline?: string;
  daysLeft?: number;
  estimatedValue?: string;
  eligibility: string[];
  tasks?: string[];
  confirmed: boolean;
  category: string;
  links: Record<string, string | undefined>;
}

export interface AirdropTrackerResult {
  timestamp: string;
  airdrops: {
    claimable: Airdrop[];
    upcoming: Airdrop[];
    rumored: Airdrop[];
    recentlyEnded: Airdrop[];
  };
  summary: {
    claimableCount: number;
    upcomingCount: number;
    rumoredCount: number;
    totalEstimatedValue: string;
    urgentDeadlines: number;
  };
}

/* ── MEV Monitor Types ── */

export interface MevBlock {
  blockNumber: number;
  mevReward: number;
  mevRewardUSD: number;
  gasUsed: number;
  txCount: number;
  builderName: string;
  timestamp: string;
  sandwichCount: number;
  arbitrageCount: number;
  liquidationCount: number;
}

export interface MevSandwich {
  hash: string;
  victimSwap: { token: string; amount: number; dex: string };
  profit: number;
  profitUSD: number;
  blockNumber: number;
  timestamp: string;
}

export interface MevBuilderShare {
  name: string;
  share: number;
  blockCount: number;
}

export interface MevMonitorResult {
  timestamp: string;
  recentBlocks: MevBlock[];
  stats: {
    totalMev24h: number;
    avgMevPerBlock: number;
    topBuilder: string;
    builderDominance: number;
    sandwichVolume24h: number;
    arbitrageProfit24h: number;
  };
  topSandwiches: MevSandwich[];
  builderShare: MevBuilderShare[];
  summary: {
    totalBlocks: number;
    avgMevUSD: number;
    sandwichRate: number;
    topMevType: string;
  };
  unavailable?: boolean;
}

/* ── TVL Geographic Heatmap Types ── */
export interface TvlGeoPoint {
  lat: number;
  lon: number;
  tvl: number;
  city: string;
  country: string;
  protocols: Array<{ name: string; tvl: number }>;
}

export interface TvlGeoResult {
  timestamp: string;
  points: TvlGeoPoint[];
  summary: {
    totalMappedTvl: number;
    totalGlobalTvl: number;
    coveragePercent: number;
    topRegion: string;
    pointCount: number;
  };
}

/* ── Bridge Flow Types (Cross-Chain Arcs) ── */
export interface BridgeFlow {
  id: string;
  sourceChain: string;
  targetChain: string;
  sourceLat: number;
  sourceLon: number;
  targetLat: number;
  targetLon: number;
  volume24h: number;
  bridgeName: string;
  txCount: number;
}

export interface BridgeFlowResult {
  timestamp: string;
  flows: BridgeFlow[];
  bridges: Array<{ name: string; volume24h: number; chains: string[] }>;
  summary: {
    totalVolume24h: number;
    activeBridges: number;
    topFlow: { from: string; to: string } | null;
    flowCount: number;
  };
}

/* ── Chain Activity Types ── */
export interface ChainActivityMetrics {
  dailyActiveAddresses: number;
  dailyActiveAddressesChange: number;
  dailyTransactions: number;
  dailyTransactionsChange: number;
  avgBlockTime: number;
  avgGasPrice: number;
  gasUsed24h: number;
  totalTxLast7d: number;
  newContracts24h: number;
  avgTxFee: number;
}

export interface ChainActivity {
  chain: string;
  name: string;
  color: string;
  metrics: ChainActivityMetrics;
}

export interface ChainActivityResult {
  timestamp: string;
  chains: ChainActivity[];
  comparison: {
    mostActive: { chain: string; txCount: number };
    fastestGrowing: { chain: string; growthPercent: number };
    cheapest: { chain: string; avgFee: number };
    mostExpensive: { chain: string; avgFee: number };
  };
  summary: {
    totalDailyTx: number;
    totalActiveAddresses: number;
    chainCount: number;
  };
  unavailable?: boolean;
}

/* ── Detail Panel Types ── */
export type DetailType = 'token' | 'protocol' | 'event' | 'news' | 'country';

export interface DetailOpenEvent {
  type: DetailType;
  data: unknown;
}

/* ── Validator Node Distribution Types ── */
export interface ValidatorNode {
  id: string;
  chain: string;
  country: string;
  countryName: string;
  lat: number;
  lon: number;
  nodeCount: number;
  percentage: number;
  client?: Record<string, number>;
}

export interface ValidatorNodesResult {
  timestamp: string;
  nodes: ValidatorNode[];
  chains: string[];
  summary: {
    totalNodes: number;
    topCountry: string;
    chainCount: number;
    nakamotoCoefficient: number;
  };
}
