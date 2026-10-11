export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

const SNAPSHOT_SPACES = [
  'aave.eth',
  'uniswapgovernance.eth',
  'ens.eth',
  'safe.eth',
  'arbitrumfoundation.eth',
  'opcollective.eth',
  'lido-snapshot.eth',
  'cvx.eth',
  'balancer.eth',
  'sushigov.eth',
  'gmx.eth',
  'starknet.eth',
  'apecoin.eth',
  'comp-vote.eth',
  'gitcoindao.eth',
];

const SNAPSHOT_URL = 'https://hub.snapshot.org/graphql';

function buildQuery(state, first) {
  return JSON.stringify({
    query: `query {
      proposals(
        first: ${first}
        skip: 0
        where: {
          space_in: ${JSON.stringify(SNAPSHOT_SPACES)}
          state: "${state}"
        }
        orderBy: "created"
        orderDirection: desc
      ) {
        id
        title
        choices
        start
        end
        state
        scores
        scores_total
        votes
        quorum
        space {
          id
          name
          avatar
          members
        }
        type
        created
        link
      }
    }`,
  });
}

function formatTimeLeft(endTs) {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTs - now;
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function mapProposal(p) {
  const scores = p.scores || [];
  const scoresTotal = p.scores_total || scores.reduce((a, b) => a + b, 0);
  const quorum = p.quorum || 0;
  const quorumReached = quorum > 0 ? scoresTotal >= quorum : false;

  // Determine result for closed proposals
  let result = undefined;
  if (p.state === 'closed' && scores.length > 0 && p.choices?.length > 0) {
    const maxIdx = scores.indexOf(Math.max(...scores));
    result = p.choices[maxIdx] || 'Unknown';
  }

  return {
    id: p.id,
    title: p.title || 'Untitled Proposal',
    space: {
      id: p.space?.id || '',
      name: p.space?.name || p.space?.id || '',
      avatar: p.space?.avatar || '',
    },
    state: p.state,
    choices: p.choices || [],
    scores,
    scoresTotal,
    votes: p.votes || 0,
    quorum,
    quorumReached,
    type: p.type || 'single-choice',
    startDate: new Date(p.start * 1000).toISOString(),
    endDate: new Date(p.end * 1000).toISOString(),
    timeLeft: formatTimeLeft(p.end),
    link: p.link || `https://snapshot.org/#/${p.space?.id}/proposal/${p.id}`,
    result,
    _members: p.space?.members || 0,
  };
}

function buildSpacesSummary(active, recent) {
  const spaceCounts = {};
  for (const p of active) {
    const sid = p.space.id;
    if (!spaceCounts[sid]) {
      spaceCounts[sid] = { id: sid, name: p.space.name, activeCount: 0, memberCount: p._members || 0 };
    }
    spaceCounts[sid].activeCount++;
  }
  // Include spaces from recent that aren't in active
  for (const p of recent) {
    const sid = p.space.id;
    if (!spaceCounts[sid]) {
      spaceCounts[sid] = { id: sid, name: p.space.name, activeCount: 0, memberCount: p._members || 0 };
    }
  }
  return Object.values(spaceCounts);
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) return new Response(null, { status: 403, headers: cors });
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // In-memory cache check
  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
        'X-Cache': 'HIT',
      },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    // Fetch active and recent proposals in parallel
    const [activeRes, recentRes] = await Promise.all([
      fetch(SNAPSHOT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildQuery('active', 30),
        signal: controller.signal,
      }),
      fetch(SNAPSHOT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildQuery('closed', 20),
        signal: controller.signal,
      }),
    ]);

    clearTimeout(timeout);

    if (!activeRes.ok && !recentRes.ok) {
      throw new Error(`Snapshot API error: active=${activeRes.status}, recent=${recentRes.status}`);
    }

    const activeJson = activeRes.ok ? await activeRes.json() : { data: { proposals: [] } };
    const recentJson = recentRes.ok ? await recentRes.json() : { data: { proposals: [] } };

    const activeProposals = (activeJson.data?.proposals || []).map(mapProposal);
    const recentProposals = (recentJson.data?.proposals || []).map(mapProposal);

    const spaces = buildSpacesSummary(activeProposals, recentProposals);

    // Find highest participation among active proposals
    let highestParticipation = { space: '', votes: 0 };
    for (const p of activeProposals) {
      if (p.votes > highestParticipation.votes) {
        highestParticipation = { space: p.space.name, votes: p.votes };
      }
    }

    // Strip internal _members field
    const cleanActive = activeProposals.map(({ _members, ...rest }) => rest);
    const cleanRecent = recentProposals.map(({ _members, ...rest }) => rest);

    const result = {
      timestamp: new Date().toISOString(),
      active: cleanActive,
      recent: cleanRecent,
      spaces,
      summary: {
        activeProposals: cleanActive.length,
        spacesTracked: SNAPSHOT_SPACES.length,
        totalVotesActive: cleanActive.reduce((sum, p) => sum + p.votes, 0),
        highestParticipation,
      },
    };

    cachedResponse = result;
    cacheTimestamp = Date.now();

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    // Return cached data if available, otherwise error
    if (cachedResponse) {
      return new Response(JSON.stringify(cachedResponse), {
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60',
          'X-Cache': 'STALE',
        },
      });
    }

    return new Response(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        active: [],
        recent: [],
        spaces: [],
        summary: { activeProposals: 0, spacesTracked: SNAPSHOT_SPACES.length, totalVotesActive: 0, highestParticipation: { space: '', votes: 0 } },
        unavailable: true,
        error: err.message || 'Snapshot API unavailable',
      }),
      {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      },
    );
  }
}
