// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§77]

// =============================================================================
// DOM interactions for X Spaces
// Event-driven via DOMObserver + self-healing via SelectorEngine
// =============================================================================

import type { Page, ElementHandle, JSHandle } from 'puppeteer';
import { EventEmitter } from 'events';
import type { SelectorEngine } from './selector-engine';
import type { DOMObserver } from './observer';
import { SELECTORS } from './selectors';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getLogger } from '../logger';
import { SpaceNotFoundError, SpaceEndedError, SpeakerAccessDeniedError } from '../errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpaceState {
  isLive: boolean;
  hasEnded: boolean;
  isSpeaker: boolean;
  speakerCount: number;
}

export interface SpaceUIOptions {
  selectorEngine?: SelectorEngine;
  observer?: DOMObserver;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Force-click an element by removing `disabled` then using Puppeteer's native
 * `.click()` which generates a trusted browser event.  Falls back to
 * `el.click()` via `page.evaluate` if the Puppeteer click throws.
 */
async function forceClick(page: Page, el: ElementHandle): Promise<void> {
  await page.evaluate((e: any) => e.removeAttribute('disabled'), el);
  // Use DOM .click() first — X's React handlers respond better to this
  // than Puppeteer's mouse move+down+up which can trigger navigation.
  // Falls back to Puppeteer's trusted click if DOM click throws.
  try {
    await page.evaluate((e: any) => e.click(), el);
  } catch {
    try {
      await el.click();
    } catch {
      // last resort: dispatch click event manually
      await page.evaluate((e: any) => {
        e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }, el);
    }
  }
}

/**
 * Trusted click using Puppeteer's page.mouse — generates real OS-level events
 * that X/React will accept. Uses bounding box coordinates.
 * DO NOT use for the join/listen button (causes navigation), only for dock buttons.
 */
async function trustedClick(page: Page, el: ElementHandle): Promise<void> {
  await page.evaluate((e: any) => {
    e.removeAttribute('disabled');
    e.scrollIntoView({ block: 'center', inline: 'center' });
  }, el);
  const box = await el.boundingBox();
  if (!box) {
    await page.evaluate((e: any) => e.click(), el);
    return;
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await new Promise(r => setTimeout(r, 100));
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 100));
  await page.mouse.up();
}

/**
 * Aggressive click using synthetic pointer/mouse event dispatch.
 * Use this when forceClick doesn't register (e.g. React dock overlays).
 */
async function dispatchClick(page: Page, el: ElementHandle): Promise<void> {
  await page.evaluate((e: any) => {
    e.removeAttribute('disabled');
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = e.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
    e.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    e.dispatchEvent(new MouseEvent('mousedown', opts));
    e.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    e.dispatchEvent(new MouseEvent('mouseup', opts));
    e.dispatchEvent(new MouseEvent('click', opts));
  }, el);
}

/**
 * Find a button whose visible text or aria-label matches one of the
 * provided `textOptions` (case-insensitive).
 */
async function findButton(
  page: Page,
  textOptions: string[],
): Promise<ElementHandle | null> {
  for (const text of textOptions) {
    const btn: JSHandle = await page.evaluateHandle((t: string) => {
      const buttons = [
        ...document.querySelectorAll(
          'button, [role="button"], div[role="button"]',
        ),
      ];
      return buttons.find((b) => {
        const content = b.textContent?.trim() || '';
        const label = b.getAttribute('aria-label') || '';
        return (
          content.toLowerCase().includes(t.toLowerCase()) ||
          label.toLowerCase().includes(t.toLowerCase())
        );
      });
    }, text);

    const el = btn.asElement();
    if (el) return el as ElementHandle;
  }
  return null;
}

/**
 * Find an element using the SelectorEngine if available, falling back to
 * legacy CSS selector + text matching.
 */
async function findElement(
  page: Page,
  selectorName: string,
  cssSelector: string,
  textOptions: string[] = [],
  engine?: SelectorEngine,
): Promise<ElementHandle | null> {
  // Prefer SelectorEngine (self-healing with fallback chain)
  if (engine) {
    try {
      const el = await engine.find(page, selectorName);
      if (el) return el;
    } catch {
      // Unknown selector name — fall through to legacy
    }
  }

  // Legacy: CSS selector
  try {
    const el: ElementHandle | null = await page.$(cssSelector);
    if (el) return el;
  } catch {
    // selector may be invalid in vanilla Puppeteer (e.g. :has-text)
  }

  // Fall back to text / aria-label search
  if (textOptions.length > 0) {
    return findButton(page, textOptions);
  }
  return null;
}

/**
 * Click an element using CDP Input.dispatchMouseEvent for a truly trusted click.
 * This bypasses all JS event listeners and React synthetic event layers.
 */
async function cdpClick(page: Page, el: ElementHandle): Promise<void> {
  const box = await el.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const client = await page.createCDPSession();
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await client.detach();
}

/**
 * Handle browser microphone permission — grant via CDP before clicking unmute.
 */
async function grantMicPermission(page: Page): Promise<void> {
  try {
    const client = await page.createCDPSession();
    await client.send('Browser.grantPermissions', {
      permissions: ['audioCapture' as any],
      origin: 'https://x.com',
    });
    await client.detach();
    getLogger().info('[X-Spaces] Granted microphone permission via CDP');
  } catch {
    getLogger().debug('[X-Spaces] Could not grant mic permission via CDP (non-fatal)');
  }
}

/**
 * Check if the agent is currently unmuted (Mute button visible, Unmute gone).
 */
export async function isMicUnmuted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hasMuteBtn = !!document.querySelector(
      'button[aria-label="Mute"], button[aria-label*="Turn off microphone"]'
    );
    const hasUnmuteBtn = !!document.querySelector(
      'button[aria-label="Unmute"], button[aria-label*="Unmute"]'
    );
    return hasMuteBtn && !hasUnmuteBtn;
  });
}

/**
 * Aggressively try to unmute the microphone using every method available.
 * Tries up to `maxAttempts` rounds, each round cycling all click strategies.
 * Also pre-grants mic permission via CDP and expands collapsed dock.
 */
export async function aggressiveUnmute(
  page: Page,
  emitter: EventEmitter,
  opts: SpaceUIOptions = {},
  maxAttempts: number = 5,
): Promise<boolean> {
  const { selectorEngine } = opts;
  getLogger().info('[X-Spaces] Aggressive unmute: starting...');

  // Pre-grant microphone permission so the browser doesn't block
  await grantMicPermission(page);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    getLogger().info(`[X-Spaces] Unmute attempt ${attempt}/${maxAttempts}`);

    if (await isMicUnmuted(page)) {
      getLogger().info('[X-Spaces] Already unmuted!');
      emitter.emit('status', 'speaking');
      return true;
    }

    await expandDockIfCollapsed(page, selectorEngine);

    const btn = await findUnmuteButton(page, selectorEngine, opts.observer);
    if (!btn) {
      getLogger().warn(`[X-Spaces] Unmute attempt ${attempt}: button not found`);

      // Try keyboard shortcuts even without a button
      if (await unmuteViaShortcutKey(page)) {
        getLogger().info('[X-Spaces] Unmuted via "m" shortcut (no button)');
        emitter.emit('status', 'speaking');
        return true;
      }
      if (await unmuteViaCDPKeyEvent(page)) {
        getLogger().info('[X-Spaces] Unmuted via CDP key event (no button)');
        emitter.emit('status', 'speaking');
        return true;
      }
      await delay(3000);
      continue;
    }

    const clickMethods = [
      { name: 'cdpClick', fn: () => cdpClick(page, btn) },
      { name: 'dispatchClick', fn: () => dispatchClick(page, btn) },
      { name: 'forceClick', fn: () => forceClick(page, btn) },
      { name: 'el.click()', fn: () => btn.click() },
      { name: 'page.mouse.click', fn: async () => {
        const box = await btn.boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }},
    ];

    for (const method of clickMethods) {
      try {
        getLogger().info(`[X-Spaces] Unmute: trying ${method.name}...`);
        await method.fn();
        await delay(2000);

        if (await isMicUnmuted(page)) {
          getLogger().info(`[X-Spaces] Unmuted via ${method.name} on attempt ${attempt}`);
          emitter.emit('status', 'speaking');
          return true;
        }

        // Dismiss any permission dialogs
        await dismissMicPermissionDialog(page);
        await delay(500);

        if (await isMicUnmuted(page)) {
          getLogger().info(`[X-Spaces] Unmuted after permission dialog via ${method.name}`);
          emitter.emit('status', 'speaking');
          return true;
        }
      } catch (err) {
        getLogger().warn(`[X-Spaces] Unmute: ${method.name} threw: ${err}`);
      }
    }

    await delay(2000);
  }

  if (await isMicUnmuted(page)) {
    getLogger().info('[X-Spaces] Unmuted (detected on final check)');
    emitter.emit('status', 'speaking');
    return true;
  }

  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => ({
        label: b.getAttribute('aria-label') || '',
        text: (b.textContent || '').trim().slice(0, 40),
        testid: b.getAttribute('data-testid') || '',
      }))
      .filter((b) => b.label || b.text),
  );
  getLogger().warn(
    `[X-Spaces] Aggressive unmute failed after ${maxAttempts} attempts. Buttons:`,
    JSON.stringify(btns.slice(0, 20)),
  );
  try {
    await page.screenshot({ path: '/workspaces/xspace-agent/debug-screenshots/aggressive-unmute-failed.png' });
  } catch { /* ignore */ }

  // Audio injection via controlled stream may still work even if UI didn't toggle
  getLogger().warn('[X-Spaces] Assuming unmuted — audio injection may still work via controlled stream');
  emitter.emit('status', 'speaking');
  return true;
}

/**
 * Dismiss any browser-level microphone permission dialog.
 */
async function dismissMicPermissionDialog(page: Page): Promise<void> {
  try {
    const dialog = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll('button, [role="button"]')];
      return btns.find((b) => {
        const text = (b.textContent || '').trim().toLowerCase();
        return text === 'allow' || text === 'allow microphone' ||
               text === 'grant' || text === 'ok' || text === 'continue';
      });
    });
    const el = dialog.asElement();
    if (el) {
      await (el as ElementHandle).click();
      getLogger().info('[X-Spaces] Dismissed permission dialog');
      await delay(500);
    }
  } catch { /* ignore */ }
}

/**
 * Expand the Space dock if it is currently collapsed.
 * X renders the dock in two states — SpaceDockExpanded / SpaceDockCollapsed.
 * When collapsed, the buttons inside are not interactable.
 */
async function expandDockIfCollapsed(
  page: Page,
  selectorEngine?: SelectorEngine,
): Promise<void> {
  // Strategy 1: data-testid based collapse detection
  const collapsed = await page.$('[data-testid="SpaceDockCollapsed"]');
  if (collapsed) {
    getLogger().info('[X-Spaces] Dock is collapsed (testid), expanding...');
    await trustedClick(page, collapsed);
    await delay(1500);
    const expanded = await page.$('[data-testid="SpaceDockExpanded"]');
    if (expanded) {
      getLogger().info('[X-Spaces] Dock expanded successfully');
      return;
    }
  }

  // Strategy 2: Check if dock buttons have zero/tiny bounding boxes
  // This happens when X renders the Space as a small sidebar card
  const requestBtn = await page.$('button[aria-label="Request to speak"]');
  const unmuteBtn = await page.$('button[aria-label="Unmute"]');
  const targetBtn = requestBtn || unmuteBtn;
  if (targetBtn) {
    const box = await targetBtn.boundingBox();
    if (!box || box.width < 10 || box.height < 10) {
      getLogger().info('[X-Spaces] Dock buttons have tiny/zero bounding box — expanding via Collapse button...');

      // Try clicking the "Collapse" button which toggles expand/collapse
      const collapseBtn = await page.$('button[aria-label="Collapse"]');
      if (collapseBtn) {
        await trustedClick(page, collapseBtn);
        await delay(2000);
        getLogger().info('[X-Spaces] Clicked Collapse toggle to expand dock');
      }

      // If still tiny, navigate to the Space URL to get full-page view
      const freshBtn = await page.$('button[aria-label="Request to speak"]') || await page.$('button[aria-label="Unmute"]');
      const box2 = freshBtn ? await freshBtn.boundingBox() : null;
      if (!box2 || box2.width < 10 || box2.height < 10) {
        // Navigate to Space URL — since we already joined, this should show full Space UI
        const currentUrl = page.url();
        let spaceUrl: string | null = null;

        // Extract Space URL from current URL or page links
        const urlMatch = currentUrl.match(/\/spaces\/(\w+)/);
        if (urlMatch) {
          spaceUrl = `https://x.com/i/spaces/${urlMatch[1]}`;
        } else {
          const href = await page.evaluate(() => {
            const links = [...document.querySelectorAll('a[href*="/spaces/"]')];
            return links[0]?.getAttribute('href') || null;
          });
          if (href) {
            spaceUrl = href.startsWith('http') ? href : `https://x.com${href}`;
          }
        }

        if (spaceUrl) {
          getLogger().info(`[X-Spaces] Buttons have tiny bounding boxes — re-navigating to Space URL: ${spaceUrl}`);
          await page.goto(spaceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await delay(3000);
        }
      }
    } else {
      getLogger().info(`[X-Spaces] Dock buttons have valid bounding box: ${box.width}x${box.height}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Navigate to a Space URL and click the Join / Listen button.
 */
export async function joinSpace(
  page: Page,
  spaceUrl: string,
  emitter: EventEmitter,
  opts: SpaceUIOptions = {},
): Promise<boolean> {
  const { selectorEngine, observer } = opts;
  getLogger().info('[X-Spaces] Navigating to Space:', spaceUrl);
  emitter.emit('status', 'joining-space');

  await page.goto(spaceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Wait for the Space UI to render rather than using a fixed delay
  try {
    await page.waitForSelector(
      `button[aria-label="Start listening"], ${SELECTORS.SPACE_JOIN_BUTTON}, ${SELECTORS.SPACE_DOCK}, ${SELECTORS.SPACE_MIC_BUTTON}`,
      { timeout: 15000 },
    );
  } catch {
    // Fall back to a short delay if no known selector appeared
    await delay(2000);
  }

  // Check if Space has ended
  const ended: boolean = await page.evaluate(() => {
    return (
      document.body.innerText.includes('This Space has ended') ||
      document.body.innerText.includes('Space ended')
    );
  });
  if (ended) {
    throw new SpaceNotFoundError(spaceUrl);
  }

  // Click Join/Listen button using SelectorEngine first, then legacy
  const joinBtn = await findElement(
    page,
    'join-button',
    SELECTORS.SPACE_JOIN_BUTTON,
    ['Start listening', 'Listen', 'Join', 'Join this Space', 'Tune in'],
    selectorEngine,
  );

  if (joinBtn) {
    // Remove disabled attribute and force-click -- X sets disabled on the
    // button even when the Space is live, so we bypass it via trusted click
    await forceClick(page, joinBtn);
    getLogger().info('[X-Spaces] Clicked join button (forced)');
    await delay(3000);
  } else {
    // Last resort: find any disabled join-like button and force-click it
    const forced: JSHandle = await page.evaluateHandle(() => {
      const candidates = [
        ...document.querySelectorAll('button, [role="button"]'),
      ];
      return candidates.find((b) => {
        const label = (
          b.getAttribute('aria-label') ||
          b.textContent ||
          ''
        ).toLowerCase();
        return (
          label.includes('listen') ||
          label.includes('join') ||
          label.includes('tune in') ||
          label.includes('start listening')
        );
      });
    });

    const forcedEl = forced.asElement();
    if (forcedEl) {
      await forceClick(page, forcedEl as ElementHandle);
      getLogger().info('[X-Spaces] Force-clicked fallback join button');
      await delay(3000);
    } else {
      getLogger().info('[X-Spaces] No join button found, may already be in Space');
    }
  }

  // After clicking join, X sometimes stays on the home feed with a mini player
  // instead of the full Space UI. Re-navigate to the Space URL to ensure we
  // get the full interactable Space view with dock buttons.
  const currentUrl = page.url();
  const isOnSpacePage = currentUrl.includes('/spaces/');
  if (!isOnSpacePage) {
    getLogger().info(`[X-Spaces] Post-join URL is not Space page (${currentUrl}), re-navigating to: ${spaceUrl}`);
    await page.goto(spaceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000);
  }

  // Check if we have the full Space UI or just a mini dock/sidebar
  const hasFullSpaceUI: boolean = await page.evaluate(() => {
    // Full Space UI has either the expanded dock or visible speaker avatars
    const hasDock = !!document.querySelector('[data-testid="SpaceDockExpanded"]');
    const hasSpeakers = !!document.querySelector('[data-testid="SpaceSpeakerAvatar"]');
    // Check if any Space button is visible and has a real bounding box
    const btns = [...document.querySelectorAll('button, [role="button"]')];
    const hasVisibleSpaceBtn = btns.some(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return (label.includes('request to speak') || label.includes('unmute') ||
              label.includes('mute') || label.includes('leave')) &&
             b.getBoundingClientRect().width > 10;
    });
    return hasDock || hasSpeakers || hasVisibleSpaceBtn;
  });

  if (!hasFullSpaceUI) {
    getLogger().info('[X-Spaces] Full Space UI not detected, re-navigating to Space URL...');
    await page.goto(spaceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000);
  }

  // Start watching for space-ended indicator if observer is available
  if (observer) {
    observer.watch('space-ended');
    observer.watch('space-live-indicator');
  }

  emitter.emit('status', 'in-space-as-listener');
  return true;
}

/**
 * Request speaker access in a Space.
 *
 * @returns `"granted"` if already a speaker, `"requested"` if the request was
 *          sent, or `false` if the button could not be found.
 */
export async function requestSpeaker(
  page: Page,
  emitter: EventEmitter,
  opts: SpaceUIOptions = {},
): Promise<'granted' | 'requested' | false> {
  const { selectorEngine } = opts;
  getLogger().info('[X-Spaces] Requesting to speak...');
  emitter.emit('status', 'requesting-speaker');

  // Bring tab to foreground — X ignores clicks on backgrounded tabs
  try { await page.bringToFront(); } catch { /* non-fatal */ }

  // Expand the Space dock if it's collapsed — buttons aren't interactable when collapsed
  await expandDockIfCollapsed(page, selectorEngine);

  // Snapshot which buttons are in the dock before we try clicking
  const dockBtnsBefore = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => ({
        label: b.getAttribute('aria-label') || '',
        text: (b.textContent || '').trim().slice(0, 50),
        testid: b.getAttribute('data-testid') || '',
      }))
      .filter((b) => b.label || b.text),
  );
  getLogger().info(`[X-Spaces] Buttons before request: ${JSON.stringify(dockBtnsBefore.slice(0, 15))}`);

  // Check for "Start speaking" button — some Spaces (broadcasts) use this
  // instead of request-to-speak, meaning we already have speaker access
  const startSpeakingBtn = await page.$('button[aria-label="Start speaking"]');
  if (startSpeakingBtn) {
    getLogger().info('[X-Spaces] Found "Start speaking" button — already have speaker access');
    emitter.emit('status', 'speaker');
    return 'granted';
  }

  // Poll for up to 20s — the request-to-speak button may take time to render
  // after the join animation completes
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    // Check if already a speaker (mic button present, or "Start speaking")
    const micBtn = await findElement(
      page,
      'mic-button',
      SELECTORS.SPACE_MIC_BUTTON,
      ['Start speaking'],
      selectorEngine,
    );
    if (micBtn) {
      getLogger().info('[X-Spaces] Already a speaker (mic button found)');
      emitter.emit('status', 'speaker');
      return 'granted';
    }

    // First try to find by specific aria-label (most reliable)
    let speakBtn: ElementHandle | null = null;
    let foundVia = 'unknown';

    // Priority 1: aria-label based (most reliable)
    speakBtn = await page.$('button[aria-label="Request to speak"]');
    if (speakBtn) {
      foundVia = 'aria-label exact';
    }

    // Priority 2: SelectorEngine (multi-strategy)
    if (!speakBtn && selectorEngine) {
      try {
        speakBtn = await selectorEngine.find(page, 'request-speaker');
        if (speakBtn) foundVia = 'selector-engine';
      } catch { /* fall through */ }
    }

    // Priority 3: broader aria-label patterns
    if (!speakBtn) {
      for (const sel of [
        'button[aria-label*="Request to speak"]',
        'button[aria-label*="request to speak"]',
        'button[aria-label*="Raise hand"]',
        'button[aria-label*="Ask to speak"]',
        'button[aria-label*="Request mic"]',
        'div[role="button"][aria-label*="Request"]',
      ]) {
        speakBtn = await page.$(sel);
        if (speakBtn) {
          foundVia = `css: ${sel}`;
          break;
        }
      }
    }

    // Priority 4: text-based search (only for specific phrases, NOT just "Request")
    if (!speakBtn) {
      speakBtn = await findButton(page, ['Request to speak', 'Raise hand', 'Ask to speak']);
      if (speakBtn) foundVia = 'text match';
    }

    // Priority 5: SVG mic icon — X Spaces mic icon has a unique gradient id="space-gradient"
    if (!speakBtn) {
      for (const sel of [
        'button:has(svg #space-gradient)',
        '[role="button"]:has(svg #space-gradient)',
      ]) {
        speakBtn = await page.$(sel);
        if (speakBtn) {
          foundVia = `svg-icon: ${sel}`;
          break;
        }
      }
    }

    // Priority 6: evaluate-based — find button containing the mic SVG by gradient
    if (!speakBtn) {
      const handle: JSHandle = await page.evaluateHandle(() => {
        const gradient = document.querySelector('#space-gradient');
        if (!gradient) return null;
        let el: Element | null = gradient;
        while (el && el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') {
          el = el.parentElement;
        }
        return el;
      });
      const el = handle.asElement();
      if (el) {
        speakBtn = el as ElementHandle;
        foundVia = 'svg-gradient-parent';
      }
    }

    if (speakBtn) {
      getLogger().info(`[X-Spaces] Found request-to-speak button via: ${foundVia}`);

      // Record whether the button existed by aria-label before clicking
      // so we can properly check if it disappeared
      const hadAriaBtn: boolean = await page.evaluate(() =>
        !!document.querySelector('button[aria-label="Request to speak"], button[aria-label*="Request to speak"], button[aria-label*="request to speak"]'),
      );

      // Try multiple click strategies — X's React dock may ignore some events
      const clickStrategies = [
        { name: 'trustedClick (OS mouse)', fn: () => trustedClick(page, speakBtn!) },
        { name: 'dispatchClick (pointer events)', fn: () => dispatchClick(page, speakBtn!) },
        { name: 'forceClick (mouse)', fn: () => forceClick(page, speakBtn!) },
        { name: 'el.click()', fn: () => speakBtn!.click() },
      ];

      for (const strategy of clickStrategies) {
        getLogger().info(`[X-Spaces] Trying ${strategy.name}...`);
        await strategy.fn();
        await delay(2000);

        // Check if UI state changed — look for positive confirmation signals
        const uiChanged: boolean = await page.evaluate((checkDisappeared: boolean) => {
          const text = document.body.innerText.toLowerCase();
          const hasConfirmation = text.includes('cancel request') || text.includes('requested') ||
                            text.includes('pending') || text.includes('waiting for host');
          if (hasConfirmation) return true;
          // Only check button disappearance if we know it was there before
          if (checkDisappeared) {
            const reqBtn = document.querySelector('button[aria-label="Request to speak"], button[aria-label*="Request to speak"], button[aria-label*="request to speak"]');
            return !reqBtn;
          }
          return false;
        }, hadAriaBtn);

        if (uiChanged) {
          getLogger().info(`[X-Spaces] Speaker request registered via ${strategy.name}`);
          break;
        }
        getLogger().warn(`[X-Spaces] ${strategy.name} did not register, trying next...`);
      }

      // X Spaces may show a confirmation dialog / bottom-sheet after the
      // initial click (e.g. "Send request", "Request", "Confirm").
      // Poll briefly for a confirmation button and click it if present.
      const confirmDeadline = Date.now() + 5000;
      while (Date.now() < confirmDeadline) {
        const confirmBtn: JSHandle = await page.evaluateHandle(() => {
          const btns = [
            ...document.querySelectorAll('button, [role="button"], div[role="button"]'),
          ];
          return btns.find((b) => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = (b.textContent || '').trim().toLowerCase();
            return (
              text === 'send request' ||
              text === 'request' ||
              text === 'confirm' ||
              label === 'send request' ||
              label.includes('send request') ||
              label.includes('confirm request')
            );
          });
        });
        const confirmEl = confirmBtn.asElement();
        if (confirmEl) {
          await dispatchClick(page, confirmEl as ElementHandle);
          getLogger().info('[X-Spaces] Clicked confirmation button in request dialog');
          await delay(1000);
          break;
        }
        await delay(500);
      }

      // Verify the request registered — look for "Cancel request", "Requested",
      // or the disappearance of the original request-to-speak button
      const verified: boolean = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('cancel request') ||
          text.includes('requested') ||
          text.includes('pending') ||
          text.includes('waiting for host')
        );
      });
      if (verified) {
        getLogger().info('[X-Spaces] Speaker request confirmed (UI state changed)');
      } else {
        getLogger().warn('[X-Spaces] Speaker request sent but could not verify UI state change');
        // Take a debug screenshot when we can't verify
        try {
          await page.screenshot({ path: '/workspaces/xspace-agent/debug-screenshots/request-speak-unverified.png' });
          getLogger().info('[X-Spaces] Debug screenshot saved: request-speak-unverified.png');
        } catch { /* ignore screenshot errors */ }
      }

      // Log buttons after the click attempt for comparison
      const dockBtnsAfter = await page.evaluate(() =>
        [...document.querySelectorAll('button, [role="button"]')]
          .map((b) => ({
            label: b.getAttribute('aria-label') || '',
            text: (b.textContent || '').trim().slice(0, 50),
          }))
          .filter((b) => b.label || b.text),
      );
      getLogger().info(`[X-Spaces] Buttons after request: ${JSON.stringify(dockBtnsAfter.slice(0, 15))}`);

      emitter.emit('status', 'speaker-requested');
      return 'requested';
    }

    await delay(2000);
  }

  // Dump visible buttons for debugging
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => ({
        label: b.getAttribute('aria-label'),
        text: b.textContent?.trim().slice(0, 40),
        testid: b.getAttribute('data-testid'),
      }))
      .filter((b) => b.label || b.text),
  );
  getLogger().warn(
    '[X-Spaces] Could not find request-to-speak button. Buttons on page:',
    JSON.stringify(btns.slice(0, 20)),
  );
  // Take debug screenshot
  try {
    await page.screenshot({ path: '/workspaces/xspace-agent/debug-screenshots/request-speak-not-found.png' });
    getLogger().info('[X-Spaces] Debug screenshot saved: request-speak-not-found.png');
  } catch { /* ignore */ }
  return false;
}

// ---------------------------------------------------------------------------
// Unmute strategies — each is tried independently until one succeeds
// ---------------------------------------------------------------------------

/**
 * Strategy 1: Click the unmute button via DOM click methods.
 * Tries dispatchClick (pointer events), forceClick (trusted mouse), el.click().
 */
async function unmuteViaButtonClick(
  page: Page,
  btn: ElementHandle,
): Promise<boolean> {
  const clickMethods = [
    { name: 'trustedClick', fn: () => trustedClick(page, btn) },
    { name: 'cdpClick', fn: () => cdpClick(page, btn) },
    { name: 'dispatchClick', fn: () => dispatchClick(page, btn) },
    { name: 'forceClick', fn: () => forceClick(page, btn) },
    { name: 'el.click()', fn: () => btn.click() },
    { name: 'page.mouse.click', fn: async () => {
      const box = await btn.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }},
  ];

  for (const method of clickMethods) {
    getLogger().info(`[X-Spaces] Unmute: trying ${method.name}...`);
    await method.fn();
    await delay(1500);
    if (await isMicUnmuted(page)) return true;
  }
  return false;
}

/**
 * Strategy 2: Focus the button and press Enter/Space key.
 * Some React handlers only respond to keyboard activation.
 */
async function unmuteViaKeyboardActivation(
  page: Page,
  btn: ElementHandle,
): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying keyboard activation (focus + Enter/Space)...');
  try {
    await btn.focus();
    await delay(200);
    await page.keyboard.press('Enter');
    await delay(1500);
    if (await isMicUnmuted(page)) return true;

    await btn.focus();
    await delay(200);
    await page.keyboard.press('Space');
    await delay(1500);
    if (await isMicUnmuted(page)) return true;
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: keyboard activation failed: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

/**
 * Strategy 3: Use the 'm' keyboard shortcut.
 * X Spaces supports pressing 'm' to toggle mute/unmute.
 */
async function unmuteViaShortcutKey(page: Page): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying "m" keyboard shortcut...');
  try {
    await page.keyboard.press('m');
    await delay(1500);
    if (await isMicUnmuted(page)) return true;

    // Also try with the page body focused first
    await page.evaluate(() => document.body.focus());
    await delay(200);
    await page.keyboard.press('m');
    await delay(1500);
    if (await isMicUnmuted(page)) return true;
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: shortcut key failed: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

/**
 * Strategy 4: Dispatch trusted key events via Chrome DevTools Protocol.
 * Bypasses Puppeteer's keyboard API for lower-level control.
 */
async function unmuteViaCDPKeyEvent(page: Page): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying CDP key dispatch...');
  let cdp;
  try {
    cdp = await page.createCDPSession();
    // Press 'm' via CDP for a fully trusted key event
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'm',
      code: 'KeyM',
      text: 'm',
      windowsVirtualKeyCode: 77,
      nativeVirtualKeyCode: 77,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'm',
      code: 'KeyM',
      text: 'm',
      windowsVirtualKeyCode: 77,
      nativeVirtualKeyCode: 77,
    });
    await delay(1500);
    if (await isMicUnmuted(page)) return true;
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: CDP key dispatch failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    try { await cdp?.detach(); } catch { /* ignore */ }
  }
  return false;
}

/**
 * Strategy 5: Dispatch touch events on the unmute button.
 * Some React event handlers only listen for touch events.
 */
async function unmuteViaTouchEvent(
  page: Page,
  btn: ElementHandle,
): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying touch events...');
  try {
    await page.evaluate((el: any) => {
      el.removeAttribute('disabled');
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const touch = new Touch({
        identifier: 1,
        target: el,
        clientX: cx,
        clientY: cy,
        pageX: cx + window.scrollX,
        pageY: cy + window.scrollY,
      });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
    }, btn);
    await delay(1500);
    if (await isMicUnmuted(page)) return true;
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: touch events failed: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

/**
 * Strategy 6: Click unmute via CDP Input.dispatchMouseEvent at element center.
 * Generates OS-level trusted mouse events that bypass React's synthetic layer.
 */
async function unmuteViaCDPMouseClick(
  page: Page,
  btn: ElementHandle,
): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying CDP mouse click...');
  let cdp;
  try {
    const box = await btn.boundingBox();
    if (!box) return false;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    cdp = await page.createCDPSession();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
    await delay(1500);
    if (await isMicUnmuted(page)) return true;
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: CDP mouse click failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    try { await cdp?.detach(); } catch { /* ignore */ }
  }
  return false;
}

/**
 * Strategy 6b: Use Puppeteer's page.mouse.click at element bounding box center.
 * Generates a trusted mouse event at the OS level.
 */
async function unmuteViaMouseClick(
  page: Page,
  btn: ElementHandle,
): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying page.mouse.click...');
  try {
    const box = await btn.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await delay(1500);
    if (await isMicUnmuted(page)) return true;
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: page.mouse.click failed: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

/**
 * Strategy 7: Enable the WebRTC audio sender track directly.
 * If unmute buttons fail, try to enable the audio track at the WebRTC level.
 */
async function unmuteViaWebRTCTrack(page: Page): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying WebRTC track enable...');
  try {
    const enabled: boolean = await page.evaluate(() => {
      // Find all RTCPeerConnections and enable their audio sender tracks
      const pcs = (window as any).__rtcPeerConnections as RTCPeerConnection[] | undefined;
      if (!pcs || pcs.length === 0) return false;

      let anyEnabled = false;
      for (const pc of pcs) {
        for (const sender of pc.getSenders()) {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = true;
            anyEnabled = true;
          }
        }
      }
      return anyEnabled;
    });

    if (enabled) {
      getLogger().info('[X-Spaces] Unmute: enabled WebRTC audio track(s)');
      // WebRTC unmute doesn't change the UI button, so we don't check isUnmuted
      return true;
    }
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: WebRTC track enable failed: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

/**
 * Strategy 8: Use getUserMedia to get a new audio stream and replace the track.
 * Last resort — creates a fresh mic stream if the existing one is dead.
 */
async function unmuteViaNewMediaStream(page: Page): Promise<boolean> {
  getLogger().info('[X-Spaces] Unmute: trying fresh getUserMedia stream...');
  try {
    const replaced: boolean = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newTrack = stream.getAudioTracks()[0];
        if (!newTrack) return false;

        const pcs = (window as any).__rtcPeerConnections as RTCPeerConnection[] | undefined;
        if (!pcs || pcs.length === 0) {
          newTrack.stop();
          return false;
        }

        let replaced = false;
        for (const pc of pcs) {
          for (const sender of pc.getSenders()) {
            if (sender.track && sender.track.kind === 'audio') {
              await sender.replaceTrack(newTrack);
              replaced = true;
            }
          }
        }
        return replaced;
      } catch {
        return false;
      }
    });

    if (replaced) {
      getLogger().info('[X-Spaces] Unmute: replaced audio track with fresh stream');
      return true;
    }
  } catch (err) {
    getLogger().warn(`[X-Spaces] Unmute: fresh media stream failed: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main unmute function — orchestrates all strategies
// ---------------------------------------------------------------------------

/**
 * Unmute the microphone using multiple strategies in priority order.
 *
 * Strategies tried (in order):
 * 1. Button click (dispatchClick → forceClick → el.click())
 * 2. Keyboard activation (focus + Enter/Space)
 * 3. "m" keyboard shortcut (X Spaces mute toggle)
 * 4. CDP trusted key event dispatch
 * 5. Touch events on the button
 * 6. CDP mouse click at button center
 * 7. WebRTC audio track enable
 * 8. Fresh getUserMedia stream replacement
 *
 * If the dock is collapsed, expands it first. If button-based strategies
 * fail and the dock might have re-collapsed, re-expands and retries.
 */
export async function unmute(
  page: Page,
  emitter: EventEmitter,
  opts: SpaceUIOptions = {},
): Promise<boolean> {
  const { selectorEngine, observer } = opts;
  getLogger().info('[X-Spaces] Unmuting...');

  // Check if already unmuted
  if (await isMicUnmuted(page)) {
    getLogger().info('[X-Spaces] Already unmuted');
    emitter.emit('status', 'speaking');
    return true;
  }

  // Pre-grant microphone permission so the browser doesn't block
  await grantMicPermission(page);

  // Bring tab to foreground — X ignores interaction on backgrounded tabs
  try { await page.bringToFront(); } catch { /* non-fatal */ }

  // Expand dock before looking for unmute button
  await expandDockIfCollapsed(page, selectorEngine);

  // Locate the unmute button using all available methods
  let unmuteBtn = await findUnmuteButton(page, selectorEngine, observer);

  // === Round 1: Button-based strategies ===
  if (unmuteBtn) {
    // Strategy 1: DOM click methods
    if (await unmuteViaButtonClick(page, unmuteBtn)) {
      getLogger().info('[X-Spaces] Unmuted via button click');
      emitter.emit('status', 'speaking');
      return true;
    }

    // Strategy 2: Keyboard activation
    if (await unmuteViaKeyboardActivation(page, unmuteBtn)) {
      getLogger().info('[X-Spaces] Unmuted via keyboard activation');
      emitter.emit('status', 'speaking');
      return true;
    }

    // Strategy 5: Touch events
    if (await unmuteViaTouchEvent(page, unmuteBtn)) {
      getLogger().info('[X-Spaces] Unmuted via touch events');
      emitter.emit('status', 'speaking');
      return true;
    }

    // Strategy 6: CDP mouse click
    if (await unmuteViaCDPMouseClick(page, unmuteBtn)) {
      getLogger().info('[X-Spaces] Unmuted via CDP mouse click');
      emitter.emit('status', 'speaking');
      return true;
    }

    // Strategy 6b: page.mouse.click at bounding box center
    if (await unmuteViaMouseClick(page, unmuteBtn)) {
      getLogger().info('[X-Spaces] Unmuted via page.mouse.click');
      emitter.emit('status', 'speaking');
      return true;
    }

    // Dismiss any mic permission dialogs that may have appeared
    await dismissMicPermissionDialog(page);
    await delay(500);
    if (await isMicUnmuted(page)) {
      getLogger().info('[X-Spaces] Unmuted after dismissing permission dialog');
      emitter.emit('status', 'speaking');
      return true;
    }
  }

  // === Round 2: Keyboard shortcuts (no button needed) ===

  // Strategy 3: 'm' keyboard shortcut
  if (await unmuteViaShortcutKey(page)) {
    getLogger().info('[X-Spaces] Unmuted via "m" shortcut');
    emitter.emit('status', 'speaking');
    return true;
  }

  // Strategy 4: CDP key event
  if (await unmuteViaCDPKeyEvent(page)) {
    getLogger().info('[X-Spaces] Unmuted via CDP key event');
    emitter.emit('status', 'speaking');
    return true;
  }

  // === Round 3: Re-expand dock and retry button click ===
  // The dock may have re-collapsed during the above attempts
  getLogger().info('[X-Spaces] Unmute: re-expanding dock for retry...');
  await expandDockIfCollapsed(page, selectorEngine);
  await delay(1000);

  unmuteBtn = await findUnmuteButton(page, selectorEngine, observer);
  if (unmuteBtn) {
    if (await unmuteViaButtonClick(page, unmuteBtn)) {
      getLogger().info('[X-Spaces] Unmuted via button click (retry after dock expand)');
      emitter.emit('status', 'speaking');
      return true;
    }
    if (await unmuteViaCDPMouseClick(page, unmuteBtn)) {
      getLogger().info('[X-Spaces] Unmuted via CDP mouse click (retry after dock expand)');
      emitter.emit('status', 'speaking');
      return true;
    }
  }

  // === Round 4: WebRTC-level fallbacks ===

  // Strategy 7: Enable existing WebRTC audio track
  if (await unmuteViaWebRTCTrack(page)) {
    getLogger().info('[X-Spaces] Unmuted via WebRTC track enable');
    emitter.emit('status', 'speaking');
    return true;
  }

  // Strategy 8: Replace with fresh audio stream
  if (await unmuteViaNewMediaStream(page)) {
    getLogger().info('[X-Spaces] Unmuted via fresh media stream');
    emitter.emit('status', 'speaking');
    return true;
  }

  // All strategies exhausted — log debug info
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => ({
        label: b.getAttribute('aria-label'),
        text: b.textContent?.trim().slice(0, 40),
        testid: b.getAttribute('data-testid'),
      }))
      .filter((b) => b.label || b.text),
  );
  getLogger().warn(
    '[X-Spaces] All unmute strategies failed. Buttons on page:',
    JSON.stringify(btns.slice(0, 20)),
  );
  try {
    await page.screenshot({ path: path.join(os.tmpdir(), 'xspace-unmute-failed.png') });
    getLogger().info('[X-Spaces] Debug screenshot saved to temp dir');
  } catch { /* ignore */ }
  return false;
}

/**
 * Locate the unmute button using observer, selector engine, and polling.
 */
async function findUnmuteButton(
  page: Page,
  selectorEngine?: SelectorEngine,
  observer?: DOMObserver,
): Promise<ElementHandle | null> {
  // Try SelectorEngine first (fastest, uses cache)
  if (selectorEngine) {
    try {
      const el = await selectorEngine.find(page, 'unmute');
      if (el) return el;
    } catch { /* fall through */ }
  }

  // Event-driven: watch for the unmute button via observer (short timeout)
  if (observer && selectorEngine) {
    const el = await new Promise<ElementHandle | null>((resolve) => {
      let resolved = false;
      const done = (el: ElementHandle | null) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        observer.removeListener('element:appeared', onAppeared);
        observer.unwatch('unmute');
        resolve(el);
      };

      const timeout = setTimeout(() => done(null), 5000);

      const onAppeared = (name: string) => {
        if (name === 'unmute') {
          selectorEngine.find(page, 'unmute').then((el) => done(el)).catch(() => done(null));
        }
      };

      observer.watch('unmute');
      observer.on('element:appeared', onAppeared);
    });
    if (el) return el;
  }

  // Polling: try direct CSS and evaluate-based search
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    // Try direct CSS
    for (const sel of [
      'button[aria-label="Unmute"]',
      'button[aria-label*="Unmute"]',
      'button[aria-label*="unmute"]',
      '[data-testid="SpaceUnmuteButton"]',
      '[data-testid="SpaceMuteButton"]',
      'button[aria-label*="Turn on microphone"]',
      'button[aria-label*="Start speaking"]',
    ]) {
      const el = await page.$(sel);
      if (el) return el as ElementHandle;
    }

    // Try SVG mic icon (unique gradient id="space-gradient")
    for (const sel of [
      'button:has(svg #space-gradient)',
      '[role="button"]:has(svg #space-gradient)',
    ]) {
      const el = await page.$(sel);
      if (el) return el as ElementHandle;
    }

    // Try evaluate-based search
    const handle: JSHandle = await page.evaluateHandle(() => {
      // First try aria-label / text matching
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const byLabel = btns.find((b) => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').trim().toLowerCase();
        return (
          label === 'unmute' ||
          label.includes('unmute') ||
          label.includes('turn on mic') ||
          label.includes('turn on microphone') ||
          label.includes('start speaking') ||
          label.includes('enable mic') ||
          label.includes('microphone is off') ||
          text === 'unmute'
        );
      });
      if (byLabel) return byLabel;

      // Fall back to SVG gradient parent walk
      const gradient = document.querySelector('#space-gradient');
      if (gradient) {
        let el: Element | null = gradient;
        while (el && el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') {
          el = el.parentElement;
        }
        if (el) return el;
      }
      return null;
    });

    const el = handle.asElement();
    if (el) return el as ElementHandle;
    await delay(1000);
  }

  return null;
}

/**
 * Ensure the mic is unmuted — call this periodically to recover from
 * accidental mutes, UI glitches, or network reconnects.
 * Uses aggressiveUnmute for maximum reliability.
 */
export async function ensureUnmuted(
  page: Page,
  emitter: EventEmitter,
  opts: SpaceUIOptions = {},
): Promise<boolean> {
  if (!(await isMicUnmuted(page))) {
    getLogger().warn('[X-Spaces] Mic appears muted — auto-recovering with aggressive unmute...');
    return aggressiveUnmute(page, emitter, opts, 3);
  }
  return true;
}

/**
 * Leave the current Space.
 */
export async function leaveSpace(
  page: Page,
  emitter: EventEmitter,
  opts: SpaceUIOptions = {},
): Promise<void> {
  const { selectorEngine, observer } = opts;
  getLogger().info('[X-Spaces] Leaving Space...');

  // Clean up watched selectors
  if (observer) {
    observer.unwatch('space-ended');
    observer.unwatch('space-live-indicator');
    observer.unwatch('unmute');
  }

  const leaveBtn = await findElement(
    page,
    'leave-button',
    SELECTORS.SPACE_LEAVE_BUTTON,
    ['Leave', 'Leave quietly', 'leave'],
    selectorEngine,
  );
  if (leaveBtn) {
    await leaveBtn.click();
    await delay(1000);

    // Confirm leave if prompted
    const confirmBtn = await findButton(page, ['Leave', 'Yes']);
    if (confirmBtn) await confirmBtn.click();
    await delay(1000);
  }

  emitter.emit('status', 'left-space');
  getLogger().info('[X-Spaces] Left Space');
}

/**
 * Read the current state of the Space from the DOM.
 * If observer is provided, augments result with watched element state.
 */
export async function getSpaceState(
  page: Page,
  opts: SpaceUIOptions = {},
): Promise<SpaceState> {
  const { observer } = opts;

  // If the observer is tracking these, use its cached state for a fast path
  if (observer) {
    const hasEnded = observer.isFound('space-ended');
    if (hasEnded) {
      return { isLive: false, hasEnded: true, isSpeaker: false, speakerCount: 0 };
    }
  }

  return await page.evaluate(() => {
    const text = document.body.innerText;
    const state: {
      isLive: boolean;
      hasEnded: boolean;
      isSpeaker: boolean;
      speakerCount: number;
    } = {
      isLive:
        text.includes('LIVE') ||
        !!document.querySelector('[data-testid="SpaceLiveIndicator"]'),
      hasEnded:
        text.includes('This Space has ended') ||
        text.includes('Space ended'),
      isSpeaker: !!document.querySelector(
        'button[aria-label*="Mute"], button[aria-label*="unmute"], button[aria-label*="Unmute"]',
      ),
      speakerCount: document.querySelectorAll(
        '[data-testid="SpaceSpeakerAvatar"]',
      ).length,
    };
    return state;
  });
}

/**
 * Wait for the host to accept the speaker request. Event-driven via observer
 * when available, with fallback to page.waitForSelector.
 *
 * Once the Unmute button appears the function clicks it and returns `true`.
 */
export async function waitForSpeakerAccess(
  page: Page,
  emitter: EventEmitter,
  timeoutMs: number = 300000,
  opts: SpaceUIOptions = {},
): Promise<boolean> {
  const { selectorEngine, observer } = opts;
  getLogger().info('[X-Spaces] Waiting for host to accept speaker request...');

  // Event-driven: use observer to wait for unmute button appearance
  if (observer && selectorEngine) {
    const appeared = await new Promise<boolean>((resolve) => {
      let resolved = false;
      const done = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        observer.removeListener('element:appeared', onAppeared);
        observer.unwatch('unmute');
        resolve(result);
      };

      const timeout = setTimeout(() => done(false), timeoutMs);

      const onAppeared = (name: string) => {
        if (name === 'unmute') {
          done(true);
        } else if (name === 'space-ended') {
          done(false);
        }
      };

      // Check if already present
      selectorEngine.find(page, 'unmute').then((el) => {
        if (el) {
          done(true);
        } else {
          observer.watch('unmute');
          observer.on('element:appeared', onAppeared);
        }
      }).catch(() => {
        observer.watch('unmute');
        observer.on('element:appeared', onAppeared);
      });
    });

    if (!appeared) {
      // Check if space ended while we were waiting
      const ended: boolean = await page.evaluate(
        () =>
          document.body.innerText.includes('This Space has ended') ||
          document.body.innerText.includes('Space ended'),
      );
      if (ended) throw new SpaceEndedError();
      throw new SpeakerAccessDeniedError();
    }
  } else {
    // Fallback: evaluate-based polling (waitForSelector can miss dock elements)
    const pollDeadline = Date.now() + timeoutMs;
    let found = false;
    while (Date.now() < pollDeadline) {
      found = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, [role="button"]')];
        return btns.some(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          return label === 'unmute' || label.includes('unmute') ||
                 label.includes('turn on microphone') || label.includes('start speaking');
        });
      });
      if (found) break;

      // Check if space ended
      const ended: boolean = await page.evaluate(
        () =>
          document.body.innerText.includes('This Space has ended') ||
          document.body.innerText.includes('Space ended'),
      );
      if (ended) throw new SpaceEndedError();

      await delay(2000);
    }
    if (!found) {
      throw new SpeakerAccessDeniedError();
    }
  }

  getLogger().info('[X-Spaces] Speaker access granted — unmuting...');
  emitter.emit('status', 'speaker');

  // Delegate to the full unmute() with all its strategies
  return unmute(page, emitter, opts);
}

/**
 * Mute the microphone in the Space. Clicks the Mute button.
 */
export async function muteSpace(
  page: Page,
  emitter: EventEmitter,
  opts: SpaceUIOptions = {},
): Promise<boolean> {
  const { selectorEngine } = opts;
  getLogger().info('[X-Spaces] Muting...');

  const muteBtn = await findElement(
    page,
    'mute',
    SELECTORS.SPACE_MUTE_BUTTON,
    ['Mute'],
    selectorEngine,
  );

  if (muteBtn) {
    await forceClick(page, muteBtn);
    await delay(500);
    getLogger().info('[X-Spaces] Muted');
    emitter.emit('status', 'muted');
    return true;
  }

  getLogger().warn('[X-Spaces] Could not find mute button');
  return false;
}


