import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// =============================================================================
// Types
// =============================================================================

type WeatherStyle = 'card' | 'forecast' | 'detailed';

interface CurrentWeather {
  temperature: number;
  weathercode: number;
  windspeed: number;
}

interface DailyForecast {
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  time: string[];
  weathercode: number[];
}

interface WeatherData {
  current_weather: CurrentWeather;
  daily: DailyForecast;
}

interface GeoResult {
  latitude: number;
  longitude: number;
  name: string;
}

interface GeoResponse {
  results?: GeoResult[];
}

interface WeatherSettings {
  city: string;
  lat: number;
  lon: number;
  style: WeatherStyle;
  useFahrenheit: boolean;
}

interface WeatherInfo {
  description: string;
  icon: string;
  type: 'clear' | 'clouds' | 'rain' | 'snow' | 'storm' | 'fog';
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'hq-weather-settings';

const DEFAULT_SETTINGS: WeatherSettings = {
  city: 'New York',
  lat: 40.7128,
  lon: -73.9352,
  style: 'card',
  useFahrenheit: false,
};

// =============================================================================
// Helpers
// =============================================================================

function getWeatherInfo(code: number): WeatherInfo {
  if (code === 0) return { description: 'Clear Sky', icon: '☀️', type: 'clear' };
  if (code <= 3) return { description: 'Partly Cloudy', icon: '⛅', type: 'clouds' };
  if (code <= 48) return { description: 'Foggy', icon: '🌫️', type: 'fog' };
  if (code <= 57) return { description: 'Drizzle', icon: '🌦️', type: 'rain' };
  if (code <= 67) return { description: 'Rain', icon: '🌧️', type: 'rain' };
  if (code <= 77) return { description: 'Snow', icon: '🌨️', type: 'snow' };
  if (code <= 82) return { description: 'Rain Showers', icon: '🌧️', type: 'rain' };
  if (code <= 86) return { description: 'Snow Showers', icon: '❄️', type: 'snow' };
  if (code <= 99) return { description: 'Thunderstorm', icon: '⛈️', type: 'storm' };
  return { description: 'Unknown', icon: '🌡️', type: 'clear' };
}

function toF(c: number): number {
  return Math.round(c * 1.8 + 32);
}

function formatTemp(c: number, useFahrenheit: boolean): string {
  return useFahrenheit ? `${toF(c)}°F` : `${Math.round(c)}°C`;
}

function getDayName(dateStr: string, idx: number): string {
  if (idx === 0) return 'Today';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function buildWeatherUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`;
}

function loadSettings(): WeatherSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: WeatherSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// =============================================================================
// Panel
// =============================================================================

export class WeatherPanel extends Panel {
  private data: WeatherData | null = null;
  private settings: WeatherSettings;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private showSearch = false;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({ id: 'weather', title: 'Weather' });
    this.settings = loadSettings();
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 15 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
    if (this.searchDebounceTimer) { clearTimeout(this.searchDebounceTimer); this.searchDebounceTimer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    try {
      const url = buildWeatherUrl(this.settings.lat, this.settings.lon);
      const res = await fetch(url, { signal: this.abortController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
      this.setDataBadge('live');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
      this.setDataBadge('unavailable');
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private async searchCity(query: string): Promise<void> {
    if (!query.trim()) return;
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`);
      if (!res.ok) {
        this.showError('City search failed - try again');
        return;
      }
      const data: GeoResponse = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0];
        this.settings.city = r.name;
        this.settings.lat = r.latitude;
        this.settings.lon = r.longitude;
        saveSettings(this.settings);
        this.showSearch = false;
        this.loading = true;
        this.renderPanel();
        void this.fetchData();
      } else {
        this.showError(`No results for "${escapeHtml(query)}"`);
      }
    } catch (err) {
      this.showError(err instanceof Error ? err.message : 'City search failed');
    }
  }

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Loading weather...'); return; }
    if (this.error || !this.data) {
      this.showError(this.error || 'No weather data');
      return;
    }

    const s = this.settings;
    const d = this.data;

    const styleButtons = (['card', 'forecast', 'detailed'] as WeatherStyle[]).map(st =>
      `<button class="weather-style-btn${s.style === st ? ' active' : ''}" data-style="${st}">${st.charAt(0).toUpperCase() + st.slice(1)}</button>`
    ).join('');

    let contentHtml = '';
    if (s.style === 'card') {
      contentHtml = this.renderCard(d, s);
    } else if (s.style === 'forecast') {
      contentHtml = this.renderForecast(d, s);
    } else {
      contentHtml = this.renderDetailed(d, s);
    }

    const html = `
      <div class="weather-container">
        <div class="weather-style-selector">${styleButtons}</div>
        <div class="weather-settings-row">
          <span class="weather-city-link" title="Click to change city">${escapeHtml(s.city)}</span>
          <button class="weather-unit-toggle">${s.useFahrenheit ? '°F' : '°C'}</button>
        </div>
        ${this.showSearch ? `
          <div class="weather-search">
            <input type="text" class="weather-search-input" placeholder="Search city..." />
            <button class="weather-search-btn">Go</button>
          </div>
        ` : ''}
        ${contentHtml}
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  private renderCard(d: WeatherData, s: WeatherSettings): string {
    const info = getWeatherInfo(d.current_weather.weathercode);
    const high = d.daily.temperature_2m_max[0] ?? 0;
    const low = d.daily.temperature_2m_min[0] ?? 0;

    return `
      <div class="weather-card">
        <span class="weather-icon-large">${info.icon}</span>
        <div class="weather-card-info">
          <span class="weather-temp-large">${formatTemp(d.current_weather.temperature, s.useFahrenheit)}</span>
          <span class="weather-desc">${escapeHtml(info.description)}</span>
          <span class="weather-hl">${escapeHtml(s.city)} · H:${formatTemp(high, s.useFahrenheit)} L:${formatTemp(low, s.useFahrenheit)}</span>
        </div>
      </div>
    `;
  }

  private renderForecast(d: WeatherData, s: WeatherSettings): string {
    const days = d.daily.time.slice(0, 5);
    return `
      <div class="weather-forecast-strip">
        ${days.map((day, i) => {
          const info = getWeatherInfo(d.daily.weathercode[i] ?? 0);
          return `
            <div class="weather-forecast-item">
              <span class="weather-forecast-day">${getDayName(day, i)}</span>
              <span class="weather-forecast-icon">${info.icon}</span>
              <span class="weather-forecast-high">${formatTemp(d.daily.temperature_2m_max[i] ?? 0, s.useFahrenheit)}</span>
              <span class="weather-forecast-low">${formatTemp(d.daily.temperature_2m_min[i] ?? 0, s.useFahrenheit)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private renderDetailed(d: WeatherData, s: WeatherSettings): string {
    const info = getWeatherInfo(d.current_weather.weathercode);
    const high = d.daily.temperature_2m_max[0] ?? 0;
    const low = d.daily.temperature_2m_min[0] ?? 0;
    const wind = d.current_weather.windspeed;

    const items = [
      { label: 'Condition', value: info.description },
      { label: 'Wind', value: `${wind} km/h` },
      { label: 'High', value: formatTemp(high, s.useFahrenheit) },
      { label: 'Low', value: formatTemp(low, s.useFahrenheit) },
      { label: 'Feels Like', value: formatTemp(d.current_weather.temperature, s.useFahrenheit) },
      { label: 'Location', value: s.city },
    ];

    return `
      <div class="weather-detailed">
        <div class="weather-detailed-main">
          <span class="weather-icon-large">${info.icon}</span>
          <span class="weather-temp-large">${formatTemp(d.current_weather.temperature, s.useFahrenheit)}</span>
        </div>
        <div class="weather-detail-grid">
          ${items.map(it => `
            <div class="weather-detail-item">
              <span class="weather-detail-label">${escapeHtml(it.label)}</span>
              <span class="weather-detail-value">${escapeHtml(it.value)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    // Style buttons
    this.content.querySelectorAll('.weather-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.settings.style = (btn as HTMLElement).dataset.style as WeatherStyle;
        saveSettings(this.settings);
        this.renderPanel();
      });
    });

    // City link toggle search
    const cityLink = this.content.querySelector('.weather-city-link');
    if (cityLink) {
      cityLink.addEventListener('click', () => {
        this.showSearch = !this.showSearch;
        this.renderPanel();
      });
    }

    // Unit toggle
    const unitBtn = this.content.querySelector('.weather-unit-toggle');
    if (unitBtn) {
      unitBtn.addEventListener('click', () => {
        this.settings.useFahrenheit = !this.settings.useFahrenheit;
        saveSettings(this.settings);
        this.renderPanel();
      });
    }

    // Search
    const searchBtn = this.content.querySelector('.weather-search-btn');
    const searchInput = this.content.querySelector('.weather-search-input') as HTMLInputElement | null;
    if (searchBtn && searchInput) {
      const doSearch = () => void this.searchCity(searchInput.value);
      searchBtn.addEventListener('click', doSearch);
      searchInput.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') doSearch();
      });
      // Debounced auto-search on typing (after 600ms idle)
      searchInput.addEventListener('input', () => {
        if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          if (searchInput.value.trim().length >= 3) doSearch();
        }, 600);
      });
      searchInput.focus();
    }
  }
}
