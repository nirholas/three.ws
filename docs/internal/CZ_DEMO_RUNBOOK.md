# CZ Demo Runbook

Live event runbook for the CZ agent demo. This is the operator's edge — when things break, refer here.

---

## Pre-Flight Checklist (T-24 hours)

- [ ] All `prompts/complete/*` changes merged to main and deployed to staging
- [ ] Staging URL loads `/cz` with avatar rendering and camera controls functional
- [ ] Base Sepolia testnet: CZ's wallet seeded with > 0.05 ETH for gas (testnet faucets if needed)
- [ ] Basescan or Block Explorer confirms agent registration state (onchain or pre-onchain)
- [ ] `GET /api/cz/identity` returns valid agent metadata JSON (or 404 if pre-onchain)
- [ ] MetaMask / hardware wallet ready with CZ's seed phrase or connected device
- [ ] Fresh browser profile created (zero extensions, zero stored cookies)
- [ ] Console clean on `/cz` load: `window.VIEWER.agent_protocol.history` shows no errors
- [ ] VPN / proxy disabled; public internet only
- [ ] Backup RPC endpoints saved locally:
    - Primary: Base Sepolia public RPC (e.g., `https://sepolia.base.org/`)
    - Secondary: Alchemy / Infura Base Sepolia endpoint (check rate limits)

---

## Pre-Flight Checklist (T-1 hour)

- [ ] Fresh browser window opened (not a tab in existing profile)
- [ ] MetaMask imported from seed or hardware wallet connected
- [ ] DNS cached: run `nslookup three.ws` twice, confirm same IP both times
- [ ] Hotspot phone ready (venue wifi fallback)
- [ ] `/cz` preloaded and avatar fully rendered; camera responds
- [ ] Dry-run entire demo flow with a throwaway wallet:
    1. Load `/cz`
    2. Click claim button (may fail; that's ok for this run)
    3. Observe modal and any error state
    4. Return to home state
- [ ] Reset `/cz/state.json` to `pre-onchain` after dry-run
- [ ] Check browser DevTools for any JavaScript errors or failed network requests
- [ ] Stopwatch ready for timing each demo step

---

## Demo Sequence (9 steps, ≤ 5 minutes total)

### Step 1: Landing (15 seconds)

**Speaker:** "This is CZ. It's an agent. And it's onchain."

- Open browser to `https://staging-url.vercel.app/cz/`
- Let avatar load and start idle animation
- Pause on the tagline / description
- **Expected screen:** Full-screen avatar with claim button visible, footer shows chain/agent ID (if onchain)

### Step 2: Passport (30 seconds)

**Speaker:** "Every agent has a passport—an onchain registration. Let me show you."

- Click the agent address chip / footer link (if onchain)
- Basescan or Sepolia block explorer opens in new tab
- Show `AgentRegistered` event or registry entry
- **Expected screen:** Block explorer showing agent's ERC-8004 registration
- _If pre-onchain:_ Skip this step; say "Registration is coming this week."

### Step 3: Claim Flow Begins (10 seconds)

**Speaker:** "CZ, can you claim this? Let's see."

- Back to CZ tab
- Click "Claim" button
- MetaMask popup appears (if not blocked by browser)
- **Expected screen:** MetaMask signature request

### Step 4: Signature (15 seconds)

**Speaker:** "Signing the claim..."

- In MetaMask, approve the signature (not a tx, just a message signature)
- Return to browser window
- Modal shows "Waiting for confirmation..."
- **Expected screen:** Spinning modal with confirmation text

### Step 5: Confirmation (30 seconds)

**Speaker:** "And it's confirmed. Confetti."

- Confetti animation plays
- Modal updates: "Claim successful"
- Transaction hash displayed (or "pre-claimed" if rehearsal mode)
- Footer updates with new owner address
- **Expected screen:** Success state with tx hash and confetti

### Step 6: Close Modal (5 seconds)

**Speaker:** "Close."

- Click close button or tap outside modal
- **Expected screen:** Back to `/cz` main page with updated owner state

### Step 7: Live in LobeHub (60 seconds)

**Speaker:** "Now watch this in LobeHub, our plugin partner."

- Open second tab to LobeHub instance (pre-loaded, or navigate to hosted instance)
- Agent appears in sidebar (same agentId)
- Type in chat: "Hello"
- Avatar animates (wave or smile)
- **Expected screen:** LobeHub chat with agent, avatar responding

### Step 8: Empathy Layer (30 seconds)

**Speaker:** "Notice the avatar's expression. It reads emotion—that's the empathy layer."

- Observe subtle emotion shifts in avatar face as agent responds
- Take a screenshot if time permits
- **Expected screen:** Avatar with visible emotion feedback

### Step 9: Close (10 seconds)

**Speaker:** "That's CZ. Questions?"

- Close tabs
- Return to home or pause for Q&A
- **Expected screen:** Ready for audience questions

**Total estimated time: 4 minutes 45 seconds**

---

## Fallbacks

### Fallback 1: Avatar Won't Render

**Symptom:** Avatar displays as blank or black, or loading spinner never stops.  
**Likely cause:** GLB file 404, CORS error, or slow network.  
**Response:**

1. Check DevTools Network tab for 404 on `/avatars/cz.glb`
2. If 404: Confirm file exists in `public/avatars/cz.glb`; restart dev server or redeploy
3. If CORS: Check that origin is in `ALLOWED_ORIGINS`
4. If slow: Wait 30 seconds; if still loading, switch to offline fallback (see below)
5. **Last resort:** Open `/cz/offline/index.html` in the same browser window; avatar is pre-bundled

### Fallback 2: Claim Transaction Pending > 45 Seconds

**Symptom:** Modal says "Waiting for confirmation…" and doesn't update.  
**Likely cause:** Base Sepolia RPC congestion or node sync lag.  
**Response:**

1. Continue narrating the feature while waiting (talk about onchain identity, wallets, etc.)
2. Check Basescan in a side window: search for the tx hash from MetaMask (if visible)
3. If tx is confirmed on-chain: Refresh the `/cz` page; state should update
4. If tx is still pending after 2 minutes:
    - Switch to fallback mode: Open `/cz?rehearsal=1` in a new tab
    - This shows a fake "already claimed" state without hitting the chain
    - Say: "We've pre-claimed this in rehearsal mode to keep the demo flowing."
5. **Root cause investigation (later):** Check Vercel logs and Base Sepolia RPC status

### Fallback 3: MetaMask Popup Blocked

**Symptom:** User clicks claim button; nothing happens.  
**Likely cause:** Browser popup blocker, or MetaMask extension not installed.  
**Response:**

1. Check address bar for popup-blocker icon; allow popups for this origin
2. Reload the page and try claim again
3. If still blocked: Click the MetaMask extension icon in the toolbar directly; wallet should open
4. If MetaMask not installed: Say "MetaMask isn't installed on this profile. We'll skip the live signing." Switch to `/cz?rehearsal=1`

### Fallback 4: Internet Drops Mid-Demo

**Symptom:** Page loads fine, then network goes dead. Avatar frozen. Claim button unresponsive.  
**Likely cause:** Venue wifi failed, or hotspot disconnected.  
**Response:**

1. Switch to hotspot (phone tethering) if available; wait 5 seconds for DNS to stabilize
2. Reload `/cz` page
3. If still offline: Open `/cz/offline/index.html` (served from browser cache); avatar and state are fully pre-rendered
4. Say: "We're offline now, but the agent still renders thanks to our offline cache."

### Fallback 5: LobeHub Embed Blank or Unresponsive

**Symptom:** LobeHub iframe loads but shows blank white space, or chat doesn't respond.  
**Likely cause:** `postMessage` origin mismatch, or LobeHub build is stale.  
**Response:**

1. Check DevTools Console for `postMessage` security warnings (frame origin mismatch)
2. Close the LobeHub tab and skip to Q&A (Step 9)
3. Say: "LobeHub integration is still rolling out; let's focus on the agent itself."
4. Optionally open our hosted agent chat in a separate window as a fallback

---

## Recovery & Graceful Exit

If the demo hits a hard blocker (venue wifi down, RPC completely unavailable, laptop crash), **here's the one-slide recovery:**

1. Show `/cz/offline/` on a phone hotspot
2. Say: "Even without live internet, the agent is ready. Here's what you just saw, fully cached and running locally."
3. Walk through the avatar and claim flow using the offline version
4. Open Q&A: "Any questions about how agents work on-chain?"

**Duration:** 2 minutes. Gets you out gracefully without losing credibility.

---

## Post-Demo Checklist

**Immediately after demo (while audience is still present):**

- [ ] Capture transaction hash from MetaMask history or Basescan (screenshot / copy to notes)
- [ ] Note the `agentId` from footer or `/api/cz/identity`
- [ ] Ask audience for immediate Q&A and feedback (record notes on pain points, questions, enthusiasm level)
- [ ] If claim failed, note the exact error message for root-cause investigation

**Within 24 hours (for post-mortem):**

- [ ] File any bugs observed: avatar performance, modal UX, RPC failures, etc.
- [ ] Upload transaction screenshot and agentId to shared incident file
- [ ] Review Vercel logs for API errors or rate-limit spikes during demo window
- [ ] Check Basescan for gas price spikes or network congestion during demo time
- [ ] Update this runbook with any gaps or timing adjustments needed for the next run

---

## Demo Environment Setup (for the operator)

### Local / Staging Setup

```bash
# Ensure staging is deployed and healthy
npm run deploy

# Check that cz endpoint is live
curl -s https://staging-url/cz | head -c 200

# Verify API is responding
curl -s https://staging-url/api/cz/identity | jq .agentId

# Pre-warm browser caches
# (open /cz in browser, let it idle for 30s)
```

### Browser Setup

- Fresh profile (no extensions except MetaMask)
- MetaMask: CZ's seed imported, Base Sepolia selected
- Two tabs pre-loaded:
    1. `https://staging-url/cz/`
    2. `https://lobehub-instance/` (or bookmark ready to click)

### Network Backup

```bash
# Save these endpoints locally for manual testing
PRIMARY_RPC="https://sepolia.base.org/"
SECONDARY_RPC="https://base-sepolia.g.alchemy.com/v2/YOUR_KEY"

# Test manually if live demo fails
curl -s -X POST $PRIMARY_RPC \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq .
```

---

## Timing Reference

| Step      | Speaker Script     | Duration   | Expected State                  |
| --------- | ------------------ | ---------- | ------------------------------- |
| 1         | Landing pitch      | 15s        | Avatar loaded, idle             |
| 2         | Passport / onchain | 30s        | Block explorer or "coming soon" |
| 3         | Claim begins       | 10s        | MetaMask popup                  |
| 4         | Signing            | 15s        | Waiting for confirmation modal  |
| 5         | Success / confetti | 30s        | Success modal + updated footer  |
| 6         | Close modal        | 5s         | Back to main page               |
| 7         | LobeHub live       | 60s        | Chat with avatar response       |
| 8         | Empathy layer      | 30s        | Avatar expressions visible      |
| 9         | Close / Q&A        | 10s        | Ready for questions             |
| **Total** |                    | **4m 45s** |                                 |

---

## Common Questions (for Operator)

**Q: What if someone asks "Can I claim it right now?"**  
A: "You can—let me show you the flow." Do a dry-run with your MetaMask in the audience. If it works, great; if not, say "The testnet is having a moment, but the code is production-ready."

**Q: What if they ask about the avatar?**  
A: "That's a GLB model—think of it as a 3D asset we can animate and rig. Every agent gets one, either pre-made or custom from a photo."

**Q: What if RPC is slow?**  
A: "Testnet is a bit congested right now. On mainnet, this would be instant." (Don't lie; testnet is slower by design.)

---
