# Supplier and subprocessor management policy

Owner and approver: the platform owner. Review cadence: every 12 months and on every provider change. Last reviewed: 2026-11-16. Approval: pending the owner's signature.

## Rules

1. **One list.** [data/subprocessors.json](../../data/subprocessors.json) is the single source for every provider that processes customer data, published at [three.ws/trust/subprocessors](https://three.ws/trust/subprocessors) with the data each receives, its region, the repository files that call it, and the provider's own terms.
2. **Add before use.** A provider key added to the production service is added to the list in the same change. The list is rebuilt from the names of the environment variables on the `three-ws-api` Cloud Run service (names only, never values), as described in [docs/trust.md](../trust.md), and `lastReviewed` is bumped.
3. **Assess before onboarding.** For a new provider the owner records: what data it receives, whether it trains on customer data (the answer must be no for customer content), its region, its published security attestations, and whether the paid tier needs approval (CLAUDE.md prefers Google Cloud surfaces and requires approval before onboarding a new paid external API).
4. **Contracts.** Data processing terms are the provider's published DPA or data page, linked from the list. Providers that process Microsoft 365 data on behalf of customers (Teams message content in the AI lane) are limited to those listed with that purpose.
5. **Monitoring.** Provider health is probed by the status page and the failover ladders; a provider incident that affects customer data follows the [incident response plan](../incident-response.md).
6. **Offboarding.** Removing a provider key removes its list row and its code path; stored provider-side data is deleted by the provider's own retention or on request.

## Changes that affect internal controls

Changes in the organisation, tooling or providers that could affect a control are assessed in the [risk register](risk-register.md) at the time of the change and in the annual review.

## Partner relationships

The Microsoft partnership is described in [docs/microsoft.md](../microsoft.md); no partner has access to production systems or customer data beyond what a customer authorises through Microsoft Marketplace, Teams or Entra.
