---
mode: agent
description: "Biometric (face photo) consent flow — required before selfie capture"
---

# Stack Layer 2 (legal): Biometric Consent

## Problem

Selfie-to-avatar involves processing biometric data. Depending on jurisdiction (GDPR, BIPA, CCPA), we need explicit informed consent before capture, retention limits, and a delete path. Ship this with the selfie flow or we can't launch it in-region.

## Implementation

### Consent modal (before stack-05)

Before `/create/` lets the user open the camera, show a consent modal:
- What we collect (one facial photo).
- What we do (send to provider [RPM or chosen], generate 3D avatar).
- How long we retain (30 days for raw photo, then delete; avatar GLB retained per user choice).
- Sub-processors listed.
- Link to full privacy policy.
- Explicit checkbox: "I understand and consent."
- Two buttons: "I consent — continue" and "Cancel."

No "Pre-checked" checkbox. No dark patterns.

### DB

`user_consents` table: `{ user_id, consent_type, granted_at, granted_ip, granted_ua, revoked_at }`. Immutable log.

### Backend enforcement

`POST /api/avatars/create-from-photo` checks the user has an active `biometric_v1` consent. If not, 403.

### Revoke / delete

`/settings/privacy/`:
- List of active consents.
- "Revoke biometric consent" button → logs revocation, triggers delete of all stored raw photos, prevents new selfie-to-avatar.
- "Delete my account" button → triggers full data deletion (avatars, memories, action log, consents). Soft-delete 30d then purge.

### Retention job

Vercel cron daily:
- Delete raw photos older than 30 days from R2 (regardless of revocation).
- For revoked consents, delete immediately (next cron run).

### Regional detection (optional)

Detect user region via `Accept-Language` + IP geolocation (rough, not gated). Show consent to EVERYONE for safety; regional detection is for showing extra disclosures (EU DPA contact, CCPA opt-out) — non-blocking.

### Documentation

Public privacy policy at `/privacy.html` — list the sub-processors, data flows, and user rights. Keep in sync with provider terms.

## Validation

- Try to create without consent → modal appears, camera won't open until consent.
- Consent → modal closes, flow continues.
- Cancel → back to `/dashboard/`.
- Revoke consent → raw photo deleted within 24h, selfie flow blocked.
- Account delete → all data gone within 30d (soft → hard).
- `npm run build` passes.

## Do not do this

- Do NOT pre-check the consent box.
- Do NOT retain photos past 30 days.
- Do NOT send photos to providers not listed in the disclosure.
