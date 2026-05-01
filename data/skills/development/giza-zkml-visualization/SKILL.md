---
name: giza-zkml-visualization
description: Giza ZKML Agent Visualization — guide covering key concepts, implementation patterns, and best practices.
license: MIT
metadata:
  category: development
  difficulty: advanced
  author: clawhub
  tags: [development, giza-zkml-visualization]
---

# Giza ZKML Agent Visualization

## Overview
Giza is a protocol for deploying verifiable AI agents on-chain using Zero-Knowledge Machine Learning (ZKML). This skill covers how Giza agents work, proof verification, and how to interpret the visualization dashboards in SperaxOS.

## Key Concepts

### Zero-Knowledge Machine Learning (ZKML)
ZKML allows AI model inferences to be verified on-chain without revealing the model weights or input data. This creates **trustless AI** — anyone can verify that a model produced a specific output from a specific input, without needing to trust the model operator.

### Giza Agents
On-chain AI agents deployed via the Giza protocol. Each agent:
- Runs a specific ML model (e.g., price prediction, risk scoring)
- Generates ZKML proofs for each inference
- Can be deployed on multiple chains (Starknet, Ethereum, Arbitrum, etc.)
- Has a verifiable track record of accuracy and performance

### Proof Systems
Giza supports multiple proof backends:
- **Cairo** — Native to Starknet, fastest proving time for StarkNet deployments
- **Noir** — Aztec Labs' DSL for ZK circuits, good for Ethereum L1
- **RISC Zero** — General-purpose zkVM, supports any computation

## SperaxOS Visualization Tool

### Agent Overview Dashboard
Shows all deployed Giza agents with:
- **Status indicators** — Green (active), Yellow (pending), Red (inactive)
- **Summary stats** — Total active agents, inference count, proof count
- **Agent rows** — Name, chain, inference count, proof count per agent

### Proof History View
Visualizes ZKML proof verification pipeline:
- **Verification rate bar** — Color-coded segments showing verified/pending/failed ratios
- **Proof rows** — Individual proofs with status badge, proof type (Cairo/Noir/RISC0), chain, duration, and timestamp
- Use this to monitor proof verification health and identify failures

### Model Performance Dashboard
Detailed metrics for a specific AI model:
- **Accuracy gauge** — Green >95%, Yellow 85-95%, Red <85%
- **Inference latency** — Average time per inference
- **Proof generation time** — Average time to generate ZKML proof
- **Inference volume sparkline** — 30-day trend of inference activity
- **Chain deployment tags** — Which chains the model is deployed on

### Protocol Analytics
Protocol-wide dashboard with:
- **Hero stats** — Total agents, active agents, total proofs, 24h proof count
- **Chain distribution bars** — Horizontal bars showing agent and proof distribution per chain
- **Dual trend chart** — Overlapping proof volume (solid purple) and agent count (dashed green) trends

## Common Use Cases

1. **"Show me Giza AI agents"** → Agent Overview
2. **"What's the proof verification rate?"** → Proof History
3. **"How is model X performing?"** → Model Performance (requires modelId)
4. **"Give me Giza protocol stats"** → Protocol Analytics
5. **"Which chains have the most Giza agents?"** → Protocol Analytics chain breakdown

## Technical Details

### API Integration
The tool connects to `api.gizatech.xyz/api/v1` with:
- Automatic retry with exponential backoff (2 retries)
- 12-second timeout per request
- Graceful fallback to curated demo data when API is unavailable

### Data Freshness
- Agent and proof data is fetched in real-time from Giza's API
- Demo data is deterministically generated for consistent visualization when API is down
- Proof timestamps and agent creation dates reflect actual on-chain activity

## Resources
- [Giza GitHub](https://github.com/gizatechxyz)
- [Giza Documentation](https://docs.gizatech.xyz)
- [ZKML Explained](https://docs.gizatech.xyz/concepts/zkml)
