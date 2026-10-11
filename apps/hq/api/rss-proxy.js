import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { UA_BROWSER } from './_ua.js';

export const config = { runtime: 'edge' };

// Fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// Browser-like request headers. Many publishers reject the default fetch UA or
// a bare UA; sending a realistic header set recovers the feeds that only do
// lightweight filtering. (Feeds behind full bot-protection / datacenter-IP
// blocks still fail - those are handled by emptyFeed() below.)
const FEED_HEADERS = {
  'User-Agent': UA_BROWSER,
  'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// A well-formed, empty RSS document. Returned with HTTP 200 whenever an
// upstream feed is unreachable (4xx/5xx, blocked, moved, or timed out) so the
// client parses zero items instead of logging a failed request on every load.
// The real upstream status is preserved in the X-Feed-Status header.
const EMPTY_RSS =
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>unavailable</title><description>Feed temporarily unavailable</description></channel></rss>';

function emptyFeed(corsHeaders, upstreamStatus) {
  return new Response(EMPTY_RSS, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60',
      'X-Feed-Status': String(upstreamStatus ?? 'error'),
      ...corsHeaders,
    },
  });
}

// Allowed RSS feed domains for security
const ALLOWED_DOMAINS = [
  'feeds.bbci.co.uk',
  'www.theguardian.com',
  'feeds.npr.org',
  'news.google.com',
  'www.aljazeera.com',
  'rss.cnn.com',
  'hnrss.org',
  'feeds.arstechnica.com',
  'www.theverge.com',
  'www.cnbc.com',
  'feeds.marketwatch.com',
  'www.defenseone.com',
  'breakingdefense.com',
  'www.bellingcat.com',
  'techcrunch.com',
  'huggingface.co',
  'www.technologyreview.com',
  'rss.arxiv.org',
  'export.arxiv.org',
  'www.federalreserve.gov',
  'www.sec.gov',
  'www.whitehouse.gov',
  'www.state.gov',
  'www.defense.gov',
  'home.treasury.gov',
  'www.justice.gov',
  'tools.cdc.gov',
  'www.fema.gov',
  'www.dhs.gov',
  'www.thedrive.com',
  'krebsonsecurity.com',
  'finance.yahoo.com',
  'thediplomat.com',
  'venturebeat.com',
  'foreignpolicy.com',
  'www.ft.com',
  'openai.com',
  'www.reutersagency.com',
  'feeds.reuters.com',
  'rsshub.app',
  'www.cfr.org',
  'www.csis.org',
  'www.politico.com',
  'www.brookings.edu',
  'layoffs.fyi',
  'www.defensenews.com',
  'www.foreignaffairs.com',
  'www.atlanticcouncil.org',
  // Tech variant domains
  'www.zdnet.com',
  'www.techmeme.com',
  'www.darkreading.com',
  'www.schneier.com',
  'rss.politico.com',
  'www.anandtech.com',
  'www.tomshardware.com',
  'www.semianalysis.com',
  'feed.infoq.com',
  'thenewstack.io',
  'devops.com',
  'dev.to',
  'lobste.rs',
  'changelog.com',
  'seekingalpha.com',
  'news.crunchbase.com',
  'www.saastr.com',
  'feeds.feedburner.com',
  // Additional tech variant domains
  'www.producthunt.com',
  'www.axios.com',
  'github.blog',
  'githubnext.com',
  'mshibanami.github.io',
  'www.engadget.com',
  'news.mit.edu',
  'dev.events',
  // VC blogs
  'www.ycombinator.com',
  'a16z.com',
  'review.firstround.com',
  'www.sequoiacap.com',
  'www.nfx.com',
  'www.aaronsw.com',
  'bothsidesofthetable.com',
  'www.lennysnewsletter.com',
  'stratechery.com',
  // Regional startup news
  'www.eu-startups.com',
  'tech.eu',
  'sifted.eu',
  'www.techinasia.com',
  'kr-asia.com',
  'techcabal.com',
  'disrupt-africa.com',
  'lavca.org',
  'contxto.com',
  'inc42.com',
  'yourstory.com',
  // Funding & VC
  'pitchbook.com',
  'www.cbinsights.com',
  // Accelerators
  'www.techstars.com',
  // Middle East & Regional News
  'english.alarabiya.net',
  'www.arabnews.com',
  'www.timesofisrael.com',
  'www.scmp.com',
  'kyivindependent.com',
  'www.themoscowtimes.com',
  'feeds.24.com',
  'feeds.capi24.com',  // News24 redirect destination
  // International Organizations
  'news.un.org',
  'www.iaea.org',
  'www.who.int',
  'www.cisa.gov',
  'www.crisisgroup.org',
  // Think Tanks & Research (Added 2026-01-29)
  'rusi.org',
  'www.rusi.org',
  'warontherocks.com',
  'www.aei.org',
  'responsiblestatecraft.org',
  'www.fpri.org',
  'jamestown.org',
  'www.chathamhouse.org',
  'ecfr.eu',
  'www.gmfus.org',
  'www.wilsoncenter.org',
  'www.lowyinstitute.org',
  'www.mei.edu',
  'www.stimson.org',
  'www.cnas.org',
  'carnegieendowment.org',
  'www.rand.org',
  'fas.org',
  'www.armscontrol.org',
  'www.nti.org',
  'thebulletin.org',
  'www.iss.europa.eu',
  // Economic & Food Security
  'www.fao.org',
  'worldbank.org',
  'www.imf.org',
  // Additional
  'news.ycombinator.com',
  // DeFi / Crypto News - Tier 1
  'www.coindesk.com',
  'www.theblock.co',
  'decrypt.co',
  'cointelegraph.com',
  'bitcoinmagazine.com',
  'blockworks.co',
  'thedefiant.io',
  'www.dlnews.com',
  'blockworks.com',
  // DeFi / Crypto News - Tier 2
  'bitcoinist.com',
  'cryptoslate.com',
  'www.newsbtc.com',
  'crypto.news',
  'cryptopotato.com',
  'ambcrypto.com',
  'beincrypto.com',
  'u.today',
  'dailyhodl.com',
  'coingape.com',
  'forkast.news',
  'unchainedcrypto.com',
  'protos.com',
  // DeFi & Web3
  'defirate.com',
  'dailydefi.org',
  'rekt.news',
  'defipulse.com',
  'www.defipulse.com',
  'newsletter.banklesshq.com',
  'defillama.com',
  'blog.yearn.finance',
  'uniswap.org',
  'aave.mirror.xyz',
  'blog.makerdao.com',
  'dappradar.com',
  // Research & Analysis
  'messari.io',
  'thedefireport.substack.com',
  'cryptobriefing.com',
  'insights.glassnode.com',
  'members.delphidigital.io',
  'www.paradigm.xyz',
  'a16zcrypto.com',
  // Security & Auditing
  'slowmist.medium.com',
  'www.certik.com',
  'blog.openzeppelin.com',
  'blog.trailofbits.com',
  'samczsun.com',
  'immunefi.medium.com',
  // L1 / L2 Ecosystems
  'solana.com',
  'near.org',
  'blog.cosmos.network',
  'blog.sui.io',
  'iohk.io',
  'polkadot.network',
  'l2beat.com',
  'optimism.mirror.xyz',
  'arbitrum.io',
  'polygon.technology',
  'starkware.medium.com',
  'zksync.mirror.xyz',
  'base.mirror.xyz',
  // Institutional & ETF
  'www.coinbase.com',
  'www.binance.com',
  'www.galaxy.com',
  'panteracapital.com',
  'multicoin.capital',
  'grayscale.com',
  'bitwiseinvestments.com',
  'www.vaneck.com',
  'blog.coinshares.com',
  'ark-invest.com',
  '21shares.com',
  // Developer & Tech
  'www.alchemy.com',
  'blog.chain.link',
  'blog.infura.io',
  'thegraph.com',
  // Mining & Energy
  'hashrateindex.com',
  'compassmining.io',
  // On-Chain Analytics
  'blog.kaiko.com',
  'coinmetrics.substack.com',
  'blog.thetie.io',
  'woobull.com',
  'cryptoquant.com',
  // Stablecoin & Derivatives
  'www.circle.com',
  'tether.to',
  'insights.deribit.com',
  // Bitcoin Ecosystem
  'lightning.engineering',
  'stacker.news',
  // Substacks & Mirrors
  'thedailygwei.substack.com',
  'wublock.substack.com',
  'medium.com',
  // NFT & Gaming
  'nftnow.com',
  'nftplazas.com',
  'playtoearn.net',
  // Mainstream Finance Crypto
  'www.bloomberg.com',
  'www.reuters.com',
  'www.forbes.com',
  'feeds.a.dj.com',
  'www.finextra.com',
  'www.pymnts.com',
  // Ethereum
  'weekinethereumnews.com',
  'etherscan.io',
  'blog.ethereum.org',
  'vitalik.eth.limo',
  'ethhub.substack.com',
  'blog.optimism.io',
  // Solana
  'www.helius.dev',
  'www.jito.network',
  'phantom.app',
];

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestUrl = new URL(req.url);
  const feedUrl = requestUrl.searchParams.get('url');

  if (!feedUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const parsedUrl = new URL(feedUrl);

    // Security: Only allow http/https protocols (prevent file://, data://, etc.)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return new Response(JSON.stringify({ error: 'Invalid protocol' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Security: Check if domain is allowed
    if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Google News is slow - use longer timeout
    const isGoogleNews = feedUrl.includes('news.google.com');
    const timeout = isGoogleNews ? 20000 : 12000;

    const response = await fetchWithTimeout(feedUrl, {
      headers: FEED_HEADERS,
      redirect: 'manual',
    }, timeout);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        try {
          const redirectUrl = new URL(location, feedUrl);
          if (!['http:', 'https:'].includes(redirectUrl.protocol) || !ALLOWED_DOMAINS.includes(redirectUrl.hostname)) {
            // Feed moved off the allowlist (e.g. to a different domain) - treat
            // as unavailable rather than erroring.
            return emptyFeed(corsHeaders, response.status);
          }
          const redirectResponse = await fetchWithTimeout(redirectUrl.href, {
            headers: FEED_HEADERS,
          }, timeout);
          if (!redirectResponse.ok) {
            return emptyFeed(corsHeaders, redirectResponse.status);
          }
          const data = await redirectResponse.text();
          return new Response(data, {
            status: 200,
            headers: {
              'Content-Type': 'application/xml',
              'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
              ...corsHeaders,
            },
          });
        } catch {
          return emptyFeed(corsHeaders, 'redirect-error');
        }
      }
    }

    // Any non-OK upstream status (403 bot-block, 404 dead feed, 5xx) degrades
    // to an empty feed so it does not surface as a failed request client-side.
    if (!response.ok) {
      return emptyFeed(corsHeaders, response.status);
    }

    const data = await response.text();
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    console.warn('RSS proxy error:', feedUrl, error.message);
    return emptyFeed(corsHeaders, isTimeout ? 'timeout' : 'fetch-error');
  }
}
