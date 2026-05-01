---
name: vc-research-intelligence
description: Analyze VC research reports from a16z, Paradigm, Messari, and top-tier firms. Extract actionable insights, identify emerging trends, and map technology outlooks to product strategy and investment decisions.
license: MIT
metadata:
  category: analysis
  difficulty: advanced
  author: sperax-team
  tags: [analysis, research, vc, a16z, paradigm, messari, trends, outlook, thesis, innovation]
---

# VC Research Intelligence

## When to use this skill

Use when the user asks about:
- a16z research, "Big Ideas", or "State of Crypto" reports
- What VCs are saying, predicting, or investing in
- Technology outlook for 1 year, 3 years, or 5 years
- Emerging trends in crypto, DeFi, AI, or web3 infrastructure
- How to incorporate VC research into product decisions
- What Paradigm, Messari, Delphi Digital, or other firms are publishing
- Industry-level trend analysis or mega-trend identification
- Mapping external research to internal roadmap priorities

## Research Sources

### Tier 1 — Crypto-Native VC Firms
| Firm | Key Publications | Cadence | URL Pattern |
|------|-----------------|---------|-------------|
| **a16z Crypto** | State of Crypto (annual), Big Ideas (annual), blog posts | Annual + ongoing | `a16zcrypto.com/state-of-crypto-*`, `a16z.com/big-ideas-*` |
| **Paradigm** | Research papers on MEV, intents, mechanism design | Quarterly | `paradigm.xyz/research` |
| **Variant Fund** | Ownership economy thesis, token distribution | Quarterly | `variant.fund/writing` |
| **Multicoin Capital** | Theses on attention economy, composability | Biannual | `multicoin.capital/writing` |

### Tier 2 — Research Platforms
| Platform | Key Publications | Cadence | Access |
|----------|-----------------|---------|--------|
| **Messari** | Annual "Crypto Theses" mega-report, sector analysis | Annual + weekly | `messari.io/crypto-theses-*` |
| **Delphi Digital** | Deep protocol analysis, sector deep-dives | Monthly | `delphidigital.io/reports` |
| **Galaxy Digital** | Institutional research, mining economics | Monthly | `galaxy.com/research` |
| **Electric Capital** | Developer ecosystem reports | Annual | `developerreport.com` |

### Tier 3 — Complementary Sources
| Source | Focus | Cadence |
|--------|-------|---------|
| **Pantera Capital** | Blockchain letters, market cycles | Monthly |
| **CoinFund** | Web3 infra, identity, storage/compute | Quarterly |
| **Placeholder VC** | Governance, fat protocol thesis | Quarterly |
| **Grayscale Research** | Institutional market structure | Monthly |

## Analysis Framework

### Phase 1: Report Ingestion & Extraction

When processing a research report:

1. **Identify source and credibility**
   - Which firm published it? What's their track record?
   - Is this their annual flagship or a regular blog post?
   - How many other firms converge on similar thesis?

2. **Extract key claims**
   - What are the specific predictions with timeframes?
   - What data/evidence supports each claim?
   - What are the confidence-affecting assumptions?

3. **Categorize themes**
   - Infrastructure (L1/L2, DA, sequencers)
   - DeFi (protocols, yields, capital efficiency)
   - AI × Crypto (agents, inference, identity)
   - Consumer (social, gaming, payments)
   - Regulation (stablecoins, securities, compliance)
   - Identity (DID, ZK-KYC, reputation)

### Phase 2: Trend Synthesis

Cross-reference across multiple reports:

1. **Consensus signal** — How many top firms mention this trend?
2. **Maturity assessment** — Emerging / Growing / Mainstream / Declining
3. **Time horizon** — Near-term (<1yr) / Mid-term (1-3yr) / Long-term (3-5yr+)
4. **Confidence score** — Based on evidence quality, firm credibility, consensus level
5. **Velocity** — Is this accelerating, steady, or decelerating vs. prior reports?

### Phase 3: Actionable Mapping

Convert research into decisions:

1. **Product roadmap alignment**
   - Which trends align with current product capabilities?
   - Which require new features or integrations?
   - What's the competitive window before trends become table stakes?

2. **Investment thesis formation**
   - Which sectors/protocols align with VC conviction?
   - Where is capital flowing (follow the money)?
   - What are the contrarian bets worth evaluating?

3. **Technology adoption**
   - What new primitives should we integrate? (e.g., intents, FHE, ERC-8004)
   - What infrastructure upgrades do VCs anticipate? (e.g., account abstraction, ZK)
   - What developer tools are gaining traction?

## Scoring Rubric

### Trend Confidence Score (0-100)

| Factor | Weight | Scoring |
|--------|--------|---------|
| VC consensus (# firms mentioning) | 30% | 1 firm: 10, 3: 40, 5: 70, 7+: 100 |
| Evidence quality | 25% | Anecdotal: 20, Data-backed: 60, Empirical: 100 |
| Market validation (live products) | 20% | None: 0, Early: 40, Growing: 70, Proven: 100 |
| Capital allocation (funding) | 15% | <$50M: 20, $50-500M: 50, $500M-1B: 75, >$1B: 100 |
| Developer momentum | 10% | Use Electric Capital data or GitHub metrics |

### Relevance to SperaxOS Score (0-100)

| Factor | Weight | Scoring |
|--------|--------|---------|
| Direct product applicability | 40% | Could we build this into SperaxOS? |
| User demand signal | 25% | Are users/community asking for this? |
| Competitive differentiation | 20% | Would this differentiate us from competitors? |
| Implementation feasibility | 15% | Can we build this with current team/stack? |

## Output Templates

### Trend Report Template
```markdown
## 📡 Trend: [Name]

**Maturity:** [Stage] | **Horizon:** [Timeframe] | **Confidence:** [Score]%

### What it is
[2-3 sentence description]

### VC Signal
- [Firm 1]: [Their specific take]
- [Firm 2]: [Their specific take]
- Consensus: [X/Y firms] mention this

### Why it matters for SperaxOS
[Specific product implications]

### Recommended actions
1. [Concrete next step]
2. [Concrete next step]
```

### Outlook Template
```markdown
## 🔭 [Category] Outlook — [Horizon]

### Summary
[Narrative summary of where this category is heading]

### Predictions
| Prediction | Confidence | Evidence | Timeframe |
|-----------|-----------|----------|-----------|
| … | High/Med/Low | … | … |

### What to build
[Specific product/feature recommendations]
```

## Integration Points

### SperaxOS Knowledge Base
- Feed processed research summaries into agent knowledge bases
- Enable semantic search across all indexed VC research
- Auto-tag research with relevant protocol/token identifiers

### Strategy Templates
- Generate investment strategy templates from VC thesis
- Create "Follow the Smart Money" style research agents
- Build trend-tracking dashboards from research signals

### Builtin Tool Integration
- Use `sperax-research-intel` tool for real-time research queries
- Combine with `sperax-crypto-news` for thesis + news correlation
- Cross-reference with `sperax-defi-analytics` for validation

### Community Feed
- Share weekly VC research digests in community feed
- Enable discussion threads on specific research findings
- Track which research predictions play out over time
