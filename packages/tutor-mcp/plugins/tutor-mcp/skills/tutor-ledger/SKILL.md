---
name: tutor-ledger
description: Read a three.ws Pay-As-You-Learn tutoring session's itemized running tab and close it for an attested invoice, using the tutor-mcp tools. Use when asked what a learning session has cost so far or to finalize and invoice a session.
---

# Pay-As-You-Learn tutor ledger

The plugin starts `@three-ws/tutor-mcp` over stdio (`npx -y @three-ws/tutor-mcp`, bin `tutor-mcp`). It needs no key or signer. The questions themselves are billed elsewhere. This server only reads and seals the ledger.

## Environment (both optional)

- `THREE_WS_BASE`: API origin, default `https://three.ws`.
- `THREE_WS_TIMEOUT_MS`: per-request timeout in milliseconds.

## Tools

| Tool | Argument | Endpoint |
| --- | --- | --- |
| `load_session` | `sessionId` (string, 1-100 characters) | `GET /api/tutor/session?sessionId=...` |
| `close_session` | `sessionId` (string, 1-100 characters) | `POST /api/tutor/session` with `{ sessionId, action: "end" }` |

## What comes back

`load_session` returns `status` (`open` or `closed`), `questionCount`, `lineItems` (one per answered question: question text, level, output tokens, cost in atomic units, a `$x.xxxxxx` string and a timestamp), `totalAtomics` and `totalUsd`. A session that is already closed also returns its `invoice`. An unknown `sessionId` returns an empty open session.

`close_session` seals the ledger. It sets status to `closed`, stamps a SHA-256 attestation over the line items and total, and returns `closedAt`, `lineItems`, `totalAtomics`, `totalUsd` and `attestation`. After closing, no more questions can be billed to that session. Closing is free and moves no funds, because the learner was already charged per question.

## Worked example

Request: "How much has session `calc-101` cost, and give me the invoice."

1. Call `load_session` with `{ "sessionId": "calc-101" }` and report `questionCount` and `totalUsd`.
2. Closing is irreversible, so confirm with the user that they want the session sealed.
3. Call `close_session` with `{ "sessionId": "calc-101" }` and return the `attestation` with the itemized `lineItems`.

## Notes

- Do not invent a `sessionId`. Use the one the user gives you, since the id is how the ledger is addressed.
- Closing cannot be undone. Always load first and confirm before closing.
