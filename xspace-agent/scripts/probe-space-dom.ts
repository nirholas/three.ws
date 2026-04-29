#!/usr/bin/env npx tsx
// =============================================================================
// probe-space-dom.ts — Join a live X Space and dump the full DOM structure
//
// Usage:
//   npx tsx scripts/probe-space-dom.ts <SPACE_URL>
//
// Requires: X_AUTH_TOKEN (and optionally X_CT0) in .env or environment.
//
// Outputs:
//   /tmp/xspace-probe-screenshot-*.png  — full-page screenshot
//   /tmp/xspace-probe-buttons.json      — every button/role=button element
//   /tmp/xspace-probe-axtree.json       — full CDP accessibility tree
//   /tmp/xspace-probe-dom.html          — outer HTML of the Space container
// =============================================================================

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env') });

puppeteer.use(StealthPlugin());

const SPACE_URL = process.argv[2];
if (!SPACE_URL) {
  console.error('Usage: npx tsx scripts/probe-space-dom.ts <SPACE_URL>');
  process.exit(1);
}

const AUTH_TOKEN = process.env.X_AUTH_TOKEN;
const CT0 = process.env.X_CT0 || '';

if (!AUTH_TOKEN) {
  console.error('X_AUTH_TOKEN not set in .env');
  process.exit(1);
}

const OUT = '/tmp';

function outPath(name: string): string {
  return path.join(OUT, name);
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

  // Navigate and verify login
  console.log('Verifying login...');
  await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 });
  const loggedIn = await page.$('[data-testid="primaryColumn"]');
  if (!loggedIn) {
    console.error('Login failed — taking screenshot');
    await page.screenshot({ path: outPath('xspace-probe-login-fail.png'), fullPage: true });
    console.log(`Screenshot: ${outPath('xspace-probe-login-fail.png')}`);
    await browser.close();
    process.exit(1);
  }
  console.log('Logged in successfully');

  // Navigate to Space
  console.log(`Navigating to Space: ${SPACE_URL}`);
  await page.goto(SPACE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  
  // Wait for Space UI to render
  console.log('Waiting for Space UI...');
  await new Promise(r => setTimeout(r, 5000));

  // Screenshot before join
  await page.screenshot({ path: outPath('xspace-probe-screenshot-1-before-join.png'), fullPage: true });
  console.log(`Screenshot 1 (before join): ${outPath('xspace-probe-screenshot-1-before-join.png')}`);

  // Dump all buttons BEFORE join
  const btnsBefore = await dumpButtons(page);
  console.log(`\n=== BUTTONS BEFORE JOIN (${btnsBefore.length}) ===`);
  for (const b of btnsBefore) {
    console.log(`  [${b.tag}] aria="${b.ariaLabel}" text="${b.text}" testid="${b.testid}" role="${b.role}" class="${b.className?.slice(0, 60)}"`);
  }

  // Try to click Join
  console.log('\nAttempting to click Join...');
  const joinBtn = await page.evaluateHandle(() => {
    const candidates = [...document.querySelectorAll('button, [role="button"], div[role="button"]')];
    return candidates.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').trim().toLowerCase();
      const testid = b.getAttribute('data-testid') || '';
      return (
        testid === 'SpaceJoinButton' ||
        label.includes('listen') ||
        label.includes('join') ||
        label.includes('tune in') ||
        text.includes('start listening') ||
        text.includes('listen') ||
        (text.includes('join') && text.length < 30)
      );
    });
  });

  const joinEl = joinBtn.asElement();
  if (joinEl) {
    await page.evaluate((e: any) => e.removeAttribute('disabled'), joinEl);
    await (joinEl as any).click();
    console.log('Clicked join button');
  } else {
    console.log('No join button found — may already be in Space');
  }

  // Wait for post-join UI to render
  console.log('Waiting 8s for post-join UI...');
  await new Promise(r => setTimeout(r, 8000));

  // Screenshot after join
  await page.screenshot({ path: outPath('xspace-probe-screenshot-2-after-join.png'), fullPage: true });
  console.log(`Screenshot 2 (after join): ${outPath('xspace-probe-screenshot-2-after-join.png')}`);

  // Dump all buttons AFTER join
  const btnsAfter = await dumpButtons(page);
  console.log(`\n=== BUTTONS AFTER JOIN (${btnsAfter.length}) ===`);
  for (const b of btnsAfter) {
    console.log(`  [${b.tag}] aria="${b.ariaLabel}" text="${b.text}" testid="${b.testid}" role="${b.role}" disabled=${b.disabled} class="${b.className?.slice(0, 80)}"`);
  }
  fs.writeFileSync(outPath('xspace-probe-buttons.json'), JSON.stringify(btnsAfter, null, 2));
  console.log(`Button dump: ${outPath('xspace-probe-buttons.json')}`);

  // Dump all elements with aria-label
  const ariaElements = await page.evaluate(() => {
    return [...document.querySelectorAll('[aria-label]')].map(el => ({
      tag: el.tagName.toLowerCase(),
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      testid: el.getAttribute('data-testid'),
      text: el.textContent?.trim().slice(0, 60),
      className: el.className?.toString().slice(0, 80),
    }));
  });
  console.log(`\n=== ALL ARIA-LABELED ELEMENTS (${ariaElements.length}) ===`);
  for (const el of ariaElements) {
    console.log(`  <${el.tag}> aria="${el.ariaLabel}" role="${el.role}" testid="${el.testid}" text="${el.text}"`);
  }

  // Dump all data-testid elements
  const testidElements = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-testid]')].map(el => ({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid'),
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      text: el.textContent?.trim().slice(0, 60),
    }));
  });
  console.log(`\n=== ALL DATA-TESTID ELEMENTS (${testidElements.length}) ===`);
  for (const el of testidElements) {
    console.log(`  <${el.tag}> testid="${el.testid}" aria="${el.ariaLabel}" role="${el.role}" text="${el.text}"`);
  }

  // CDP Accessibility tree
  console.log('\nFetching CDP accessibility tree...');
  const client = await page.createCDPSession();
  try {
    const axTree = await client.send('Accessibility.getFullAXTree');
    const interactiveNodes = axTree.nodes
      .filter((n: any) => {
        const role = n.role?.value || '';
        const name = n.name?.value || '';
        return (
          role === 'button' ||
          role === 'toggle button' ||
          role === 'menuitem' ||
          name.toLowerCase().includes('mute') ||
          name.toLowerCase().includes('speak') ||
          name.toLowerCase().includes('request') ||
          name.toLowerCase().includes('microphone') ||
          name.toLowerCase().includes('mic') ||
          name.toLowerCase().includes('hand') ||
          name.toLowerCase().includes('join') ||
          name.toLowerCase().includes('listen')
        );
      })
      .map((n: any) => ({
        role: n.role?.value,
        name: n.name?.value,
        description: n.description?.value,
        nodeId: n.nodeId,
        properties: n.properties?.map((p: any) => ({ name: p.name, value: p.value?.value })),
      }));

    console.log(`\n=== ACCESSIBILITY TREE — INTERACTIVE NODES (${interactiveNodes.length}) ===`);
    for (const n of interactiveNodes) {
      console.log(`  [${n.role}] name="${n.name}" desc="${n.description || ''}" props=${JSON.stringify(n.properties?.slice(0, 5))}`);
    }
    fs.writeFileSync(outPath('xspace-probe-axtree.json'), JSON.stringify(interactiveNodes, null, 2));
    console.log(`AX tree dump: ${outPath('xspace-probe-axtree.json')}`);
  } catch (err) {
    console.error('CDP AX tree failed:', err);
  }

  // Dump outer HTML of main Space container
  const spaceHTML = await page.evaluate(() => {
    // Try common Space container selectors
    const container =
      document.querySelector('[data-testid="SpaceRoot"]') ||
      document.querySelector('[data-testid="Spacedock"]') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('#react-root');
    return container?.outerHTML?.slice(0, 200000) || document.body.outerHTML.slice(0, 200000);
  });
  fs.writeFileSync(outPath('xspace-probe-dom.html'), spaceHTML);
  console.log(`DOM dump: ${outPath('xspace-probe-dom.html')}`);

  // Wait another 5s and take another screenshot (Space may have animations)
  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: outPath('xspace-probe-screenshot-3-settled.png'), fullPage: true });
  console.log(`Screenshot 3 (settled): ${outPath('xspace-probe-screenshot-3-settled.png')}`);

  // Final button dump after settle
  const btnsFinal = await dumpButtons(page);
  if (JSON.stringify(btnsFinal) !== JSON.stringify(btnsAfter)) {
    console.log(`\n=== BUTTONS AFTER SETTLE (${btnsFinal.length}) ===`);
    for (const b of btnsFinal) {
      console.log(`  [${b.tag}] aria="${b.ariaLabel}" text="${b.text}" testid="${b.testid}" role="${b.role}" disabled=${b.disabled}`);
    }
  } else {
    console.log('\nButtons unchanged after settle');
  }

  console.log('\n=== PROBE COMPLETE ===');
  console.log('Files:');
  console.log(`  ${outPath('xspace-probe-screenshot-1-before-join.png')}`);
  console.log(`  ${outPath('xspace-probe-screenshot-2-after-join.png')}`);
  console.log(`  ${outPath('xspace-probe-screenshot-3-settled.png')}`);
  console.log(`  ${outPath('xspace-probe-buttons.json')}`);
  console.log(`  ${outPath('xspace-probe-axtree.json')}`);
  console.log(`  ${outPath('xspace-probe-dom.html')}`);

  await browser.close();
}

interface ButtonInfo {
  tag: string;
  ariaLabel: string | null;
  text: string;
  testid: string | null;
  role: string | null;
  disabled: boolean;
  className: string;
  type: string | null;
  id: string | null;
  parentTag: string | null;
  parentRole: string | null;
  parentAriaLabel: string | null;
}

async function dumpButtons(page: any): Promise<ButtonInfo[]> {
  return page.evaluate(() => {
    return [...document.querySelectorAll('button, [role="button"], div[role="button"], a[role="button"]')].map(el => ({
      tag: el.tagName.toLowerCase(),
      ariaLabel: el.getAttribute('aria-label'),
      text: (el.textContent || '').trim().slice(0, 80),
      testid: el.getAttribute('data-testid'),
      role: el.getAttribute('role'),
      disabled: (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
      className: (el.className?.toString() || '').slice(0, 100),
      type: el.getAttribute('type'),
      id: el.getAttribute('id'),
      parentTag: el.parentElement?.tagName.toLowerCase() || null,
      parentRole: el.parentElement?.getAttribute('role') || null,
      parentAriaLabel: el.parentElement?.getAttribute('aria-label') || null,
    }));
  });
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});


