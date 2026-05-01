---
name: dao-governance-analysis
description: Analyze DAO governance structures, proposals, voting patterns, and power distribution to assess governance health and participation quality.
license: MIT
metadata:
  category: community
  difficulty: intermediate
  author: sperax-team
  tags: [community, dao, governance, voting, proposals]
---

# DAO Governance Analysis

## When to use this skill

Use when the user asks about:
- Evaluating a DAO's governance structure
- Analyzing a specific governance proposal
- Understanding voting power distribution
- Assessing governance health and participation
- Comparing governance models across protocols

## Governance Analysis Framework

### 1. Governance Structure Overview

Document the governance architecture:
- **Governance type**: Token-weighted, quadratic, conviction, optimistic, or hybrid
- **Governance token**: Which token grants voting power? Is it the same as the protocol token?
- **Voting mechanism**: On-chain (Compound Governor, OpenZeppelin Governor) or off-chain (Snapshot) or hybrid
- **Proposal lifecycle**: Discussion (forum) -> formal proposal -> voting -> execution
- **Quorum requirements**: Minimum participation threshold for a vote to be valid
- **Approval threshold**: What percentage of votes must be "for" to pass?
- **Timelock**: How long between vote passing and execution?
- **Delegation**: Can token holders delegate votes? What percentage is delegated?

### 2. Proposal Analysis

For a specific governance proposal, evaluate:
- **Proposal summary**: What is being proposed in plain language?
- **Author**: Who submitted it? Track record of previous proposals?
- **Impact scope**: Does this change protocol parameters, treasury allocation, or governance itself?
- **Technical implementation**: Is there executable code attached? Has it been reviewed/audited?
- **Community discussion**: What is the forum sentiment? Key arguments for and against?
- **Financial impact**: Does this proposal have treasury implications? How much?
- **Risk assessment**: What could go wrong if this proposal passes?
- **Reversibility**: Can this change be undone if it causes problems?

### 3. Voting Power Distribution

Analyze the concentration of governance power:

| Metric | Assessment |
|--------|------------|
| Top 10 voters' share | What % of voting power do the top 10 addresses hold? |
| Nakamoto coefficient | How many voters needed to reach 51% of voting power? |
| Delegation patterns | Are votes concentrated in a few delegates? |
| Team/Investor voting | Do team/investor wallets actively vote? Which way? |
| Voter participation rate | What % of token supply actually votes? |
| Unique voter count | How many distinct addresses vote on average? |

Red flags:
- Top 5 addresses controlling > 50% of voting power
- Voter participation below 5% of circulating supply
- Team/investors consistently controlling outcomes
- Single delegate accumulating > 20% of delegated power

### 4. Governance Health Metrics

Assess overall governance quality:
- **Proposal frequency**: How many proposals per month? (Too few = inactive, too many = chaotic)
- **Passage rate**: What percentage of proposals pass? (Very high = rubber stamping, very low = dysfunction)
- **Voter turnout trend**: Is participation growing, stable, or declining?
- **Discussion quality**: Are forum discussions substantive or superficial?
- **Execution reliability**: Are passed proposals actually executed on time?
- **Delegate diversity**: Is there a diverse set of active delegates with different viewpoints?
- **Governance attacks**: Any history of flash loan governance attacks or hostile proposals?

### 5. Governance Model Comparison

When comparing across DAOs:

| Dimension | DAO A | DAO B | DAO C |
|-----------|-------|-------|-------|
| Governance type | | | |
| Quorum | | | |
| Approval threshold | | | |
| Avg. voter turnout | | | |
| Nakamoto coefficient | | | |
| Timelock period | | | |
| Delegate count | | | |
| Proposals/month | | | |

### 6. Governance Risk Assessment

Identify specific governance risks:
- **Plutocracy risk**: Wealthy token holders dominating all outcomes
- **Apathy risk**: Insufficient participation to meet quorum or represent community
- **Capture risk**: Special interest groups (VCs, large holders) controlling governance for their benefit
- **Execution risk**: Proposals passing but not being implemented
- **Speed risk**: Governance too slow to respond to emergencies (exploits, market events)
- **Complexity risk**: Governance process too complicated for average token holders to participate

### 7. Output Format

- **DAO**: Name and governance token
- **Governance model**: Type and key parameters
- **Health score**: Healthy / Functional / Concerning / Dysfunctional
- **Power distribution**: Decentralized / Moderately concentrated / Highly concentrated
- **Participation**: Strong / Adequate / Low / Critical
- **Key strengths**: Top 2-3 governance positives
- **Key risks**: Top 2-3 governance concerns
- **Proposal assessment** (if analyzing a specific proposal): Support / Oppose / Abstain with reasoning
- **Recommendations**: Specific improvements to governance health
