#!/usr/bin/env npx tsx
// =============================================================================
// test-selectors.ts — Join a live X Space and verify our selectors work
//
// Usage:
//   npx tsx scripts/test-selectors.ts <SPACE_URL>
//
// Tests each selector from packages/core/src/browser/selectors.ts against the
// live DOM, reporting which ones match and which ones fail.
// =============================================================================

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env') });

puppeteer.use(StealthPlugin());

const SPACE_URL = process.argv[2];
if (!SPACE_URL) {
  console.error('Usage: npx tsx scripts/test-selectors.ts <SPACE_URL>');
  process.exit(1);
}

const AUTH_TOKEN = process.env.X_AUTH_TOKEN;
const CT0 = process.env.X_CT0 || '';

if (!AUTH_TOKEN) {
  console.error('X_AUTH_TOKEN not set in .env');
  process.exit(1);
}

// Import the actual selectors we want to test
// We inline the key selectors here to avoid import/build issues with the monorepo
const SELECTORS_TO_TEST = {
  // Before join
  'join-button (aria exact)': 'button[aria-label="Start listening"]',
  'join-button (testid)': '[data-testid="SpaceJoinButton"]',
  'join-button (aria partial)': 'button[aria-label*="listen" i]',
  'join-button (aria join)': 'button[aria-label*="join" i]',

  // After join — Space dock
  'space-dock (expanded)': '[data-testid="SpaceDockExpanded"]',
  'space-dock (collapsed)': '[data-testid="SpaceDockCollapsed"]',

  // After join — request to speak
  'request-speaker (aria exact)': 'button[aria-label="Request to speak"]',
  'request-speaker (aria partial)': 'button[aria-label*="Request"]',
  'request-speaker (testid)': '[data-testid="SpaceRequestToSpeakButton"]',

  // After join — mic controls
  'unmute (aria exact)': 'button[aria-label="Unmute"]',
  'unmute (aria partial)': 'button[aria-label*="Unmute"]',
  'mute (aria exact)': 'button[aria-label="Mute"]',
  'mute (aria partial)': 'button[aria-label*="Mute"]',
  'mic-button (testid)': '[data-testid="SpaceMuteButton"]',

  // Leave (has NO aria-label — only text content)
  'leave (aria-i)': 'button[aria-label*="leave" i]',
  'leave (testid)': '[data-testid="SpaceLeaveButton"]',
  'leave (dock child)': '[data-testid="SpaceDockExpanded"] button',

  // Other Space UI
  'manage-space': 'button[aria-label="Manage Space"]',
  'react': 'button[aria-label="React"]',
  'collapse': 'button[aria-label="Collapse"]',
  'pip': 'button[aria-label="Picture-in-Picture"]',
} as const;

async function testSelectors(page: any, phase: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SELECTOR RESULTS — ${phase}`);
  console.log(`${'='.repeat(60)}`);

  let pass = 0;
  let fail = 0;

  for (const [name, selector] of Object.entries(SELECTORS_TO_TEST)) {
    try {
      const el = await page.$(selector);
      if (el) {
        const info = await page.evaluate((e: Element) => ({
          aria: e.getAttribute('aria-label'),
          text: e.textContent?.trim().slice(0, 50),
          disabled: (e as HTMLButtonElement).disabled,
        }), el);
        console.log(`  ✅ ${name.padEnd(35)} → aria="${info.aria}" text="${info.text}" disabled=${info.disabled}`);
        pass++;
      } else {
        console.log(`  ❌ ${name.padEnd(35)} → NOT FOUND`);
        fail++;
      }
    } catch {
      console.log(`  ❌ ${name.padEnd(35)} → ERROR (invalid selector?)`);
      fail++;
    }
  }

  // Also test text-based search (our findButton fallback)
  console.log(`\n  --- Text-based search (findButton fallback) ---`);
  const textSearches = [
    'Start listening',
    'Request to speak',
    'Leave',
    'Unmute',
    'Mute',
  ];
  for (const text of textSearches) {
    const found = await page.evaluate((t: string) => {
      const buttons = [
        ...document.querySelectorAll('button, [role="button"]'),
      ];
      const match = buttons.find((b) => {
        const content = b.textContent?.trim() || '';
        const label = b.getAttribute('aria-label') || '';
        return (
          content.toLowerCase().includes(t.toLowerCase()) ||
          label.toLowerCase().includes(t.toLowerCase())
        );
      });
      if (!match) return null;
      return {
        aria: match.getAttribute('aria-label'),
        text: match.textContent?.trim().slice(0, 50),
        tag: match.tagName.toLowerCase(),
      };
    }, text);

    if (found) {
      console.log(`  ✅ text="${text}"`.padEnd(42) + `→ <${found.tag}> aria="${found.aria}" text="${found.text}"`);
      pass++;
    } else {
      console.log(`  ❌ text="${text}"`.padEnd(42) + `→ NOT FOUND`);
      fail++;
    }
  }

  console.log(`\n  Summary: ${pass} passed, ${fail} failed\n`);
}

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Set auth cookies
  console.log('Setting auth cookies...');
  const cookies: Array<{ name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean }> = [
    {
      name: 'auth_token',
      value: AUTH_TOKEN,
      domain: '.x.com',
      path: '/',
      httpOnly: true,
      secure: true,
    },
  ];
  if (CT0) {
    cookies.push({
      name: 'ct0',
      value: CT0,
      domain: '.x.com',
      path: '/',
      httpOnly: false,
      secure: true,
    });
  }
  await page.setCookie(...cookies);

  // Verify login
  console.log('Verifying login...');
  await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 });
  const loggedIn = await page.$('[data-testid="primaryColumn"]');
  if (!loggedIn) {
    console.error('❌ Login failed');
    await page.screenshot({ path: '/tmp/xspace-test-login-fail.png', fullPage: true });
    await browser.close();
    process.exit(1);
  }
  console.log('✅ Logged in');

  // Navigate to Space
  console.log(`Navigating to Space: ${SPACE_URL}`);
  await page.goto(SPACE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 5000));

  // Test selectors BEFORE join
  await testSelectors(page, 'BEFORE JOIN');

  // Click join
  console.log('\nClicking join button...');
  const joinBtn = await page.$('button[aria-label="Start listening"]')
    || await page.$('button[aria-label*="Listen"]')
    || await page.$('button[aria-label*="Join"]')
    || await page.$('[data-testid="SpaceJoinButton"]');

  if (joinBtn) {
    await page.evaluate((e: any) => e.removeAttribute('disabled'), joinBtn);
    await joinBtn.click();
    console.log('✅ Clicked join button');
  } else {
    console.log('⚠️  No join button found — may already be in Space');
  }

  // Wait for post-join UI
  console.log('Waiting 8s for post-join UI...');
  await new Promise(r => setTimeout(r, 8000));

  // Test selectors AFTER join
  await testSelectors(page, 'AFTER JOIN');

  // Screenshot
  await page.screenshot({ path: '/tmp/xspace-test-selectors.png', fullPage: true });
  console.log('Screenshot: /tmp/xspace-test-selectors.png');

  // Leave the space to be clean
  const leaveBtn = await page.$('button[aria-label*="Leave"]');
  if (leaveBtn) {
    await leaveBtn.click();
    console.log('Left the Space');
  }

  await browser.close();
  console.log('\n✅ Done');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});


