# CZ Offline Fallback Demo

This directory contains the offline fallback for the CZ demo — a self-contained, zero-network-dependency copy of the demo that the operator can display if live internet fails during the event.

## Overview

**Purpose:** Keep the demo running when the internet dies, RPC node is down, or the staging server is unreachable.

**File:** `index.html` — standalone HTML page with embedded assets.

**Network:** Zero external dependencies after initial page load. Avatar and state are served from origin only.

**Usage:** Open `https://3dagent.vercel.app/cz/offline/` in a browser, or `http://localhost:3000/cz/offline/` for local dev.

---

## How It Works

### Avatar Loading
- Tries to load `/avatars/cz.glb` from the origin (served from `public/avatars/cz.glb`)
- If available, renders with Three.js (if loaded on the page)
- If unavailable or WebGL fails, falls back to a canvas-drawn placeholder
- **No external CDN calls; no IPFS gateway requests**

### Claim Flow
- User clicks "Claim Agent" button
- Modal plays a simulated claim sequence:
  1. "Initializing claim flow…" (800ms)
  2. "Connecting wallet…" (800ms)
  3. "Submitting claim…" (800ms)
  4. "Waiting for confirmation…" (800ms)
  5. "Claim Successful!" + confetti (no delay)
- **No blockchain calls; no MetaMask interaction**
- No transaction is actually submitted; this is purely visual

### State Display
- Footer shows static values:
  - Agent ID: `0x1234567` (placeholder)
  - Chain: `Base Sepolia`
  - Owner: Not displayed (since no real onchain state)
- **All values are hardcoded; no API calls**

### Cache & Service Worker
- Page registers a service worker at `/cz/sw.js` (if available)
- If the page is cached, it loads instantly even if origin is unreachable
- Service worker is optional; page works without it

---

## Testing the Offline Fallback

### Test 1: Network Throttling
```bash
# Open DevTools → Network tab
# Set throttling to "Offline"
# Reload the page
# Avatar and claim flow should still work
```

### Test 2: Hard Offline (Kill WiFi)
```bash
# Open /cz/offline/ in a browser
# Physically unplug ethernet or disable WiFi
# Page should still display avatar and respond to clicks
```

### Test 3: Origin Unreachable
```bash
# Open /cz/offline/ normally
# Block the origin in DevTools (DevTools → Network → Disable)
# Reload page (from browser cache)
# Fallback image and claim flow work
```

### Test 4: Timing (Dry Run)
```bash
# Open /cz/offline/
# Click "Claim Agent" button
# Observe:
#   - First modal appears at 0ms: "Initializing…"
#   - Second modal at 800ms: "Connecting…"
#   - Confetti at 3200ms
# Total: ~4 seconds from click to success
```

---

## Integration with Live Demo

### When to Switch to Offline
- Avatar fails to load for > 30 seconds
- RPC node is down or extremely congested (claim stuck > 2 minutes)
- Entire staging server is unreachable (502/503)
- WiFi drops mid-demo

### How to Switch
1. **In the browser:** Open a new tab or window to `/cz/offline/`
2. **Say to audience:** "We're in offline mode now, but the agent is fully cached and ready."
3. **Run the demo:** Same 9-step sequence, but the claim is instant (no real tx)
4. **Be honest:** If asked, say "This is a pre-rendered demo version—on mainnet, this would be live."

### Before/After Behavior
| Aspect | Live (`/cz`) | Offline (`/cz/offline/`) |
|---|---|---|
| Avatar | Loaded from `/avatars/cz.glb` (live) | Loaded from `/avatars/cz.glb` (cached) or fallback image |
| Claim TX | Real signature + submit to RPC | Fake modal, no tx |
| State | From `/api/cz/identity` (live API) | Hardcoded placeholder |
| Claim Time | 30–60 seconds | ~4 seconds |
| Network | Requires live staging + RPC | Zero external calls |

---

## Customization

### Change Hardcoded Values
In `index.html`, search for these and update:
```javascript
Agent ID: 0x1234567   // Change to real agentId
Chain: Base Sepolia   // Keep or update
```

### Change Claim Timing
In `index.html`, `handleClaimClick()` function:
```javascript
setTimeout(() => { ... }, 800)   // First modal at 800ms
setTimeout(() => { ... }, 1600)  // Second modal at 1600ms
// etc.
```

### Change Colors / Styling
In the `<style>` section:
```css
background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);  /* bg color */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);  /* button color */
```

### Add a Real Screenshot Fallback
If Three.js is unavailable, the fallback currently draws a placeholder on canvas. To add a real screenshot:
1. Take a screenshot of the live demo (`/cz`) with avatar rendered
2. Save as `fallback.png` in this directory
3. Update `loadFallback()` in `index.html` to use the image:
   ```javascript
   fallback.src = '/cz/offline/fallback.png';
   ```

---

## Limitations & Future Work

### Current Limitations
- Avatar rendering is a placeholder (no Three.js integration yet)
- Claim flow is purely visual (no real blockchain state)
- State values are hardcoded (no dynamic data from API)
- Service worker (`/cz/sw.js`) is not yet implemented

### Future Enhancements
- [ ] Embed actual GLB file as base64 in HTML (self-contained binary)
- [ ] Integrate Three.js for full 3D avatar rendering
- [ ] Implement `/cz/sw.js` for offline caching
- [ ] Parameterize agentId and chain from URL query params
- [ ] Add pre-recorded video loop of agent interaction (if available)
- [ ] Support keyboard controls (arrow keys for camera, Space to claim)

---

## Files

- `index.html` — Main offline page (this is all you need)
- `README.md` — This file

---

## Troubleshooting

### Avatar shows as placeholder, not 3D
- Check DevTools Console for errors
- Verify `/avatars/cz.glb` is being loaded (Network tab)
- Confirm Three.js is available (try `typeof THREE` in console)

### Claim button doesn't respond
- Check DevTools Console for JavaScript errors
- Refresh the page
- Try in incognito mode (clear cookies)

### Service worker not registered
- `/cz/sw.js` may not exist yet (that's ok; page still works)
- Check DevTools → Application → Service Workers for status
- This is optional for offline demo to work

### Page is slow or jittery
- Close other browser tabs (free up memory)
- Disable browser extensions
- Try a different browser (Chrome, Firefox, Safari, Edge)

---

## Contact / Issues

If the offline fallback isn't working or needs updates, file an issue or reach out to the team.

For live demo day:
- **Backup operator:** Have a second laptop with offline page pre-loaded
- **Screenshot:** Keep a static screenshot of the success state as a final fallback
- **Notes:** Write down any issues encountered for post-mortem

---
