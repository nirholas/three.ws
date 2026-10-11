import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// =============================================================================
// Types
// =============================================================================

interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  image: string;
}

interface FearGreedResponse {
  data: Array<{ value: string; value_classification: string }>;
}

interface TokenSentiment {
  symbol: string;
  name: string;
  score: number;
  sentiment: string;
  mentions: number;
}

interface SentimentData {
  overallScore: number;
  overall: string;
  tokens: TokenSentiment[];
}

// =============================================================================
// Helpers
// =============================================================================

function deriveSentimentLabel(score: number): string {
  if (score >= 75) return 'Very Bullish';
  if (score >= 60) return 'Bullish';
  if (score >= 45) return 'Neutral';
  if (score >= 30) return 'Bearish';
  return 'Very Bearish';
}

function deriveOverallLabel(score: number): string {
  if (score >= 75) return 'Extreme Greed';
  if (score >= 60) return 'Greed';
  if (score >= 45) return 'Neutral';
  if (score >= 30) return 'Fear';
  return 'Extreme Fear';
}

function getSentimentColor(score: number): string {
  if (score <= 25) return '#ff4444';
  if (score <= 40) return '#ff8844';
  if (score <= 55) return '#ffaa00';
  if (score <= 70) return '#88cc44';
  return '#44ff88';
}

function getSentimentTagClass(sentiment: string): string {
  switch (sentiment) {
    case 'Very Bullish': return 'sentiment-tag-bullish-strong';
    case 'Bullish': return 'sentiment-tag-bullish';
    case 'Neutral': return 'sentiment-tag-neutral';
    case 'Bearish': return 'sentiment-tag-bearish';
    case 'Very Bearish': return 'sentiment-tag-bearish-strong';
    default: return 'sentiment-tag-neutral';
  }
}

function formatMentions(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// =============================================================================
// Panel
// =============================================================================

export class SocialSentimentPanel extends Panel {
  private data: SentimentData | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super({ id: 'social-sentiment', title: 'Social Sentiment', showCount: true });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 2 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      // Fetch CoinGecko markets and Fear & Greed in parallel
      const [marketsRes, fngRes] = await Promise.allSettled([
        fetch('/api/coingecko', { signal }),
        fetch('https://api.alternative.me/fng/?limit=1', { signal }),
      ]);

      let marketCoins: MarketCoin[] = [];
      if (marketsRes.status === 'fulfilled' && marketsRes.value.ok) {
        const mData = await marketsRes.value.json();
        marketCoins = Array.isArray(mData) ? mData : (mData.data ?? []);
      }

      let fngValue: number | null = null;
      let fngClassification: string | null = null;
      if (fngRes.status === 'fulfilled' && fngRes.value.ok) {
        const fng: FearGreedResponse = await fngRes.value.json();
        if (fng.data?.[0]) {
          fngValue = parseInt(fng.data[0].value, 10);
          fngClassification = fng.data[0].value_classification;
        }
      }

      if (marketCoins.length === 0) throw new Error('No market data');

      // Overall score from Fear & Greed or average price change fallback
      const overallScore = fngValue ?? Math.min(100, Math.max(0, Math.round(
        50 + marketCoins.slice(0, 10).reduce((s, c) => s + (c.price_change_percentage_24h ?? 0), 0) / 10 * 3
      )));

      // Top 8 coins by volume as "most talked about"
      const topCoins = [...marketCoins]
        .sort((a, b) => (b.total_volume ?? 0) - (a.total_volume ?? 0))
        .slice(0, 8);

      const tokens: TokenSentiment[] = topCoins.map(coin => {
        const change = coin.price_change_percentage_24h ?? 0;
        const score = Math.min(100, Math.max(0, Math.round(50 + change * 3)));
        return {
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          score,
          sentiment: deriveSentimentLabel(score),
          mentions: Math.round((coin.total_volume ?? 0) / 10_000),
        };
      });

      this.data = {
        overallScore,
        overall: fngClassification ?? deriveOverallLabel(overallScore),
        tokens,
      };
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

  private renderPanel(): void {
    if (this.loading) { this.showLoading('Analyzing sentiment...'); return; }
    if (this.error || !this.data) {
      this.showError(this.error || 'No sentiment data');
      return;
    }

    const d = this.data;
    this.setCount(d.tokens.length);
    const overallColor = getSentimentColor(d.overallScore);

    const html = `
      <div class="sentiment-container">
        <div class="sentiment-overall">
          <div class="sentiment-gauge">
            <svg viewBox="0 0 120 120" width="110" height="110">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" stroke-width="8" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="${overallColor}" stroke-width="8"
                stroke-dasharray="${d.overallScore * 3.14} 314"
                stroke-linecap="round" transform="rotate(-90 60 60)" />
              <text x="60" y="55" text-anchor="middle" fill="${overallColor}" font-size="28" font-weight="700" font-family="monospace">${d.overallScore}</text>
              <text x="60" y="72" text-anchor="middle" fill="var(--text-dim)" font-size="10">/100</text>
            </svg>
          </div>
          <div class="sentiment-overall-label" style="color:${overallColor}">${escapeHtml(d.overall)}</div>
        </div>

        <div class="sentiment-tokens">
          <div class="sentiment-tokens-header">Token Sentiment</div>
          ${d.tokens.map(t => `
            <div class="sentiment-token-row" data-symbol="${escapeHtml(t.symbol)}" style="cursor:pointer">
              <div class="sentiment-token-info">
                <span class="sentiment-token-symbol">${escapeHtml(t.symbol)}</span>
                <span class="sentiment-tag ${getSentimentTagClass(t.sentiment)}">${escapeHtml(t.sentiment)}</span>
              </div>
              <div class="sentiment-token-meta">
                <span class="sentiment-mentions">${formatMentions(t.mentions)} vol</span>
                <span class="sentiment-score" style="color:${getSentimentColor(t.score)}">${t.score}</span>
              </div>
              <div class="sentiment-bar-bg">
                <div class="sentiment-bar-fill" style="width:${t.score}%;background:${getSentimentColor(t.score)}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.setContent(html);

    // Wire click handlers on token rows
    const rows = this.content.querySelectorAll('.sentiment-token-row[data-symbol]');
    rows?.forEach(row => {
      row.addEventListener('click', () => {
        const symbol = (row as HTMLElement).dataset.symbol || '';
        const name = (row as HTMLElement).dataset.name || symbol;
        window.dispatchEvent(new CustomEvent('detail:open', {
          detail: { type: 'token', data: { symbol, name } },
        }));
      });
    });
  }
}
