import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { timeAgo } from '@/utils/defi-format';

// ── Feed definition ──────────────────────────────────────────────────
interface FeedDef { name: string; url: string; }

function rss(name: string, rawUrl: string): FeedDef {
  return { name, url: '/api/rss-proxy?url=' + encodeURIComponent(rawUrl) };
}



interface FeedItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

/** Per-feed fetch timeout in ms */
const FEED_TIMEOUT_MS = 12_000;

/** Parse a date string, returning 0 for unparseable values */
function safeTimestamp(dateStr: string): number {
  const ts = new Date(dateStr).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

// ── Base RSS feed panel ──────────────────────────────────────────────
class RssFeedPanel extends Panel {
  private items: FeedItem[] = [];
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private feeds: FeedDef[];
  private abortController: AbortController | null = null;

  constructor(id: string, title: string, feeds: FeedDef[]) {
    super({ id, title, showCount: true });
    this.feeds = feeds;
    void this.fetchAll();
    this.refreshInterval = setInterval(() => this.fetchAll(), 5 * 60_000);
  }

  public destroy(): void {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.abortController?.abort();
    this.abortController = null;
    super.destroy();
  }

  private async fetchAll(): Promise<void> {
    // Cancel any in-flight request batch
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;

    this.loading = true;
    this.renderPanel();

    try {
      const results = await Promise.allSettled(
        this.feeds.map(async feed => {
          try {
            const res = await fetch(feed.url, {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(FEED_TIMEOUT_MS),
              ]),
            });
            if (!res.ok) return [];
            const text = await res.text();
            return this.parseRss(text, feed.name);
          } catch (err) {
            // Per-feed timeout shouldn't abort sibling feeds
            if ((err as Error).name === 'TimeoutError') return [];
            throw err;
          }
        })
      );

      // Bail if this fetch batch was superseded
      if (controller.signal.aborted) return;

      const allItems: FeedItem[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') allItems.push(...r.value);
      }

      // Dedupe by link
      const seen = new Set<string>();
      const deduped = allItems.filter(i => {
        if (seen.has(i.link)) return false;
        seen.add(i.link);
        return true;
      });

      deduped.sort((a, b) => safeTimestamp(b.pubDate) - safeTimestamp(a.pubDate));
      this.items = deduped.slice(0, 40);
      this.error = null;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      if (!controller.signal.aborted) {
        this.loading = false;
        this.renderPanel();
      }
    }
  }

  private parseRss(xml: string, sourceName: string): FeedItem[] {
    const items: FeedItem[] = [];

    // Try RSS 2.0 <item> format
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemStr = match[1] ?? '';
      const title = itemStr.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1]
        || itemStr.match(/<title>(.*?)<\/title>/)?.[1] || '';
      const link = itemStr.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate = itemStr.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

      if (title && link) {
        items.push({
          title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
          link: link.trim(),
          pubDate: pubDate || new Date().toISOString(),
          source: sourceName,
        });
      }
    }

    // If no RSS items found, try Atom <entry> format
    if (items.length === 0) {
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      while ((match = entryRegex.exec(xml)) !== null) {
        const entryStr = match[1] ?? '';
        const title = entryStr.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>|<title[^>]*>(.*?)<\/title>/)?.[1]
          || entryStr.match(/<title[^>]*>(.*?)<\/title>/)?.[1] || '';
        // Atom uses <link href="..." /> or <link rel="alternate" href="..." />
        const link = entryStr.match(/<link[^>]*rel=["']alternate["'][^>]*href=["'](.*?)["'][^>]*\/?>/)
          ?.[1] || entryStr.match(/<link[^>]*href=["'](.*?)["'][^>]*\/?>/)
          ?.[1] || '';
        const pubDate = entryStr.match(/<updated>(.*?)<\/updated>/)?.[1]
          || entryStr.match(/<published>(.*?)<\/published>/)?.[1] || '';

        if (title && link) {
          items.push({
            title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
            link: link.trim(),
            pubDate: pubDate || new Date().toISOString(),
            source: sourceName,
          });
        }
      }
    }

    return items.slice(0, 10);
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading('Loading…');
      return;
    }
    if (this.error && !this.items.length) {
      this.showError(this.error);
      return;
    }
    if (!this.items.length) {
      this.showError('No articles available');
      return;
    }

    this.setCount(this.items.length);

    const html = `
      <div class="defi-news-list">
        ${this.items.map(item => {
          const detailJson = escapeHtml(JSON.stringify({ title: item.title, url: item.link, source: item.source, publishedAt: item.pubDate }));
          return `
          <div class="defi-news-item-row" style="display:flex;align-items:start;gap:4px">
            <a class="defi-news-item" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" style="flex:1;min-width:0">
              <div class="defi-news-meta">
                <span class="defi-news-source">${escapeHtml(item.source)}</span>
                <span class="defi-news-time">${timeAgo(item.pubDate)}</span>
              </div>
              <div class="defi-news-title">${escapeHtml(item.title)}</div>
            </a>
            <button class="detail-open-btn" data-detail-news='${detailJson}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;margin-left:4px;opacity:0.6;flex-shrink:0" title="View details">ℹ</button>
          </div>
        `;
        }).join('')}
      </div>
    `;

    this.setContent(html);
    this.bindDetailButtons();
  }

  private bindDetailButtons(): void {
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.detail-open-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(btn.getAttribute('data-detail-news') || '{}');
        window.dispatchEvent(new CustomEvent('detail:open', { detail: { type: 'news', data } }));
      } catch { /* ignore parse errors */ }
    });
  }
}

// ── Individual category panels ───────────────────────────────────────

/** ⭐ Top DeFi News - major outlets */
export class DefiNewsPanel extends RssFeedPanel {
  constructor() {
    super('defi-news', 'DeFi News', [
      rss('CoinDesk',        'https://www.coindesk.com/arc/outboundfeeds/rss/'),
      rss('The Block',       'https://www.theblock.co/rss.xml'),
      rss('Decrypt',         'https://decrypt.co/feed'),
      rss('Cointelegraph',   'https://cointelegraph.com/rss'),
      rss('Blockworks',      'https://blockworks.com/feed'),
      rss('Bitcoin Magazine', 'https://bitcoinmagazine.com/.rss/full/'),
      rss('The Defiant',     'https://thedefiant.io/feed'),
      rss('Unchained',       'https://unchainedcrypto.com/feed/'),
      rss('Protos',          'https://protos.com/feed/'),
      rss('CryptoPotato',    'https://cryptopotato.com/feed'),
      rss('Bitcoinist',      'https://bitcoinist.com/feed/'),
      rss('NewsBTC',         'https://www.newsbtc.com/feed/'),
      rss('CoinGape',        'https://coingape.com/feed/'),
    ]);
  }
}

/** 🏦 DeFi Protocol News - protocol blogs & DeFi-specific outlets */
export class DefiProtocolNewsPanel extends RssFeedPanel {
  constructor() {
    super('defi-protocol-news', 'DeFi Protocols', [
      rss('DeFi Rate',    'https://defirate.com/feed/'),
      rss('Compound',     'https://medium.com/feed/compound-finance'),
      rss('DappRadar',    'https://dappradar.com/blog/feed'),
    ]);
  }
}

/** 🔬 Crypto Research - analysts, quant shops, VC research arms */
export class CryptoResearchPanel extends RssFeedPanel {
  constructor() {
    super('crypto-research', 'Crypto Research', [
      rss('Messari',         'https://messari.io/rss'),
      rss('DeFi Report',     'https://thedefireport.substack.com/feed'),
      rss('Crypto Briefing',  'https://cryptobriefing.com/feed/'),
      rss('Glassnode',       'https://insights.glassnode.com/rss/'),
      rss('Delphi Digital',  'https://members.delphidigital.io/feed'),
      rss('Paradigm',        'https://news.google.com/rss/search?q=%22Paradigm%22+crypto+OR+web3+OR+DeFi+research+when:14d&hl=en-US&gl=US&ceid=US:en'),
      rss('a16z Crypto',     'https://news.google.com/rss/search?q=%22a16z+crypto%22+OR+%22Andreessen+Horowitz%22+crypto+web3+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Coin Metrics',    'https://coinmetrics.substack.com/feed'),
      rss('Kaiko',           'https://news.google.com/rss/search?q=Kaiko+crypto+OR+%22crypto+data%22+Kaiko+when:14d&hl=en-US&gl=US&ceid=US:en'),
      rss('Deribit Insights', 'https://insights.deribit.com/feed/'),
      rss('Multicoin Capital', 'https://multicoin.capital/rss.xml'),
    ]);
  }
}

/** 🛡️ Security - auditors, exploit analysis, smart contract security */
export class CryptoSecurityPanel extends RssFeedPanel {
  constructor() {
    super('crypto-security', 'Crypto Security', [
      rss('SlowMist',       'https://slowmist.medium.com/feed'),
      rss('CertiK',         'https://www.certik.com/resources/blog/rss.xml'),
      rss('OpenZeppelin',   'https://news.google.com/rss/search?q=OpenZeppelin+security+OR+audit+OR+smart+contract+when:14d&hl=en-US&gl=US&ceid=US:en'),
      rss('Trail of Bits',  'https://blog.trailofbits.com/feed/'),
      rss('samczsun',       'https://samczsun.com/rss/'),
      rss('Immunefi',       'https://immunefi.medium.com/feed'),
    ]);
  }
}

/** ⛓️ L1/L2 Ecosystems - chain blogs & ecosystem updates */
export class L1L2NewsPanel extends RssFeedPanel {
  constructor() {
    super('l1l2-news', 'L1/L2 Ecosystems', [
      rss('Ethereum',   'https://news.google.com/rss/search?q=%22Week+in+Ethereum%22+OR+%22Ethereum+news%22+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Daily Gwei', 'https://thedailygwei.substack.com/feed'),
      rss('Solana',     'https://solana.com/news/rss.xml'),
      rss('L2BEAT',     'https://news.google.com/rss/search?q=L2BEAT+OR+%22layer+2%22+scaling+when:14d&hl=en-US&gl=US&ceid=US:en'),
      rss('Optimism',   'https://news.google.com/rss/search?q=Optimism+L2+OR+OP+Stack+crypto+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Arbitrum',   'https://news.google.com/rss/search?q=Arbitrum+L2+OR+%22Arbitrum+chain%22+crypto+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Polygon',    'https://news.google.com/rss/search?q=Polygon+crypto+OR+%22Polygon+chain%22+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Base',       'https://news.google.com/rss/search?q=Base+L2+Coinbase+OR+%22Base+chain%22+crypto+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('zkSync',     'https://news.google.com/rss/search?q=zkSync+OR+%22ZK+Sync%22+crypto+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('NEAR',       'https://news.google.com/rss/search?q=NEAR+Protocol+crypto+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Cosmos',     'https://news.google.com/rss/search?q=Cosmos+crypto+OR+%22Cosmos+Hub%22+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Sui',        'https://blog.sui.io/feed/'),
      rss('Cardano',    'https://news.google.com/rss/search?q=Cardano+crypto+OR+ADA+blockchain+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Polkadot',   'https://news.google.com/rss/search?q=Polkadot+crypto+OR+DOT+parachain+when:7d&hl=en-US&gl=US&ceid=US:en'),
    ]);
  }
}

/** 🏛️ Institutional - exchanges, asset managers, ETF issuers */
export class InstitutionalCryptoPanel extends RssFeedPanel {
  constructor() {
    super('institutional-crypto', 'Institutional Crypto', [
      rss('Coinbase',       'https://news.google.com/rss/search?q=site:coinbase.com+OR+%22Coinbase%22+crypto+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Galaxy Digital',  'https://news.google.com/rss/search?q=%22Galaxy+Digital%22+crypto+when:14d&hl=en-US&gl=US&ceid=US:en'),
      rss('Pantera Capital', 'https://panteracapital.com/feed/'),
      rss('Grayscale',      'https://news.google.com/rss/search?q=Grayscale+crypto+OR+GBTC+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('Bitwise',        'https://news.google.com/rss/search?q=%22Bitwise%22+crypto+ETF+when:14d&hl=en-US&gl=US&ceid=US:en'),
      rss('Circle',         'https://news.google.com/rss/search?q=Circle+USDC+OR+%22Circle+crypto%22+when:7d&hl=en-US&gl=US&ceid=US:en'),
      rss('CoinDesk',       'https://www.coindesk.com/arc/outboundfeeds/rss/'),
      rss('The Block',      'https://www.theblock.co/rss.xml'),
      rss('Blockworks',     'https://blockworks.com/feed'),
    ]);
  }
}

/** ₿ Bitcoin - Bitcoin-focused news, mining, Lightning */
export class BitcoinNewsPanel extends RssFeedPanel {
  constructor() {
    super('bitcoin-news', 'Bitcoin News', [
      rss('Bitcoin Magazine', 'https://bitcoinmagazine.com/.rss/full/'),
      rss('Mining News',     'https://bitcoinmagazine.com/tags/mining/.rss/full/'),
      rss('Stacker News',    'https://stacker.news/rss'),
      rss('Hashrate Index',  'https://hashrateindex.com/blog/feed/'),
    ]);
  }
}

/** Ξ Ethereum - Ethereum ecosystem, DeFi, L2s */
export class EthereumNewsPanel extends RssFeedPanel {
  constructor() {
    super('ethereum-news', 'Ethereum News', [
      rss('Ethereum Blog',   'https://blog.ethereum.org/feed.xml'),
      rss('Vitalik Buterin', 'https://vitalik.eth.limo/feed.xml'),
      rss('EthHub Weekly',   'https://ethhub.substack.com/feed'),
    ]);
  }
}

/** ◎ Solana - Solana ecosystem, DeFi, NFTs */
export class SolanaNewsPanel extends RssFeedPanel {
  constructor() {
    super('solana-news', 'Solana News', [
      rss('Solana Blog',      'https://solana.com/news/rss.xml'),
      rss('Helius Blog',      'https://www.helius.dev/blog/rss.xml'),
      rss('Jito Labs',        'https://www.jito.network/blog/rss/'),
      rss('Marinade Finance', 'https://medium.com/feed/marinade-finance'),
    ]);
  }
}

/** 🛠️ Dev - developer tooling, smart contract infra */
export class CryptoDevPanel extends RssFeedPanel {
  constructor() {
    super('crypto-dev', 'Crypto Dev', [
      rss('Alchemy',    'https://www.alchemy.com/blog/rss'),
      rss('Chainlink',  'https://blog.chain.link/feed/'),
      rss('Infura',     'https://blog.infura.io/feed/'),
      rss('The Graph',  'https://thegraph.com/blog/feed'),
    ]);
  }
}
