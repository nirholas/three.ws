---
name: agent-trust
title: "three.ws Agent Trust"
description: "Counterparty checks for AI agents: 0-100 reputation scores for wallets, mints, and agents from on-chain evidence, admit or refuse verdicts against a trust policy, on-chain identity claim verification, and sourced fact checks."
use_case: "Use when an agent is about to pay, hire, trade with, or delegate to an unknown wallet, token, or agent: score its reputation, gate it with a trust policy, verify an address it claims, or fact-check a claim it made."
category: identity
service_url: https://three.ws
openapi:
  path: openapi.json
---

Trust primitives for agent-to-agent commerce on three.ws. An agent about to
pay, hire, or delegate to a counterparty it has never met can buy evidence
first: a deterministic reputation score from on-chain history and settled
agent payments, a door verdict against its own trust policy, proof that an
identity really controls the address it claims, and a sourced verdict on a
factual claim.

Unknown subjects return a null score rather than an invented one, and every
verdict carries the evidence behind it.

## Spend-aware usage

- Check a counterparty once per session and cache the verdict; scores move
  slowly.
- Use `agent-bouncer` when you already hold a three.ws agent id and a policy;
  it is the cheapest yes-or-no gate.
- Use `agent-reputation` for wallets and mints outside three.ws.
- Keep fact-check claims to one checkable statement each. The first
  3 checks per day per IP are served free (marked `lane: "free"`);
  after that each check returns a 402.
