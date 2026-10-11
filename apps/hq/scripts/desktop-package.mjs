#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (name) => args.includes(`--${name}`);

const os = getArg('os');
const variant = getArg('variant') ?? 'full';
const sign = hasFlag('sign');
const showHelp = hasFlag('help') || hasFlag('h');

const validOs = new Set(['macos', 'windows']);
const validVariants = new Set(['full', 'tech']);

if (showHelp) {
  console.log('Usage: npm run desktop:package -- --os <macos|windows> --variant <full|tech> [--sign]');
  process.exit(0);
}

if (!validOs.has(os)) {
  console.error('Usage: npm run desktop:package -- --os <macos|windows> --variant <full|tech> [--sign]');
  process.exit(1);
}

if (!validVariants.has(variant)) {
  console.error('Invalid variant. Use --variant full or --variant tech.');
  process.exit(1);
}

const bundles = os === 'macos' ? 'app,dmg' : 'nsis,msi';
const env = {
  ...process.env,
  VITE_VARIANT: variant,
  VITE_DESKTOP_RUNTIME: '1',
};
const cliArgs = ['build', '--bundles', bundles];
const tauriBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');

if (!existsSync(tauriBin)) {
  console.error(
    `Local Tauri CLI not found at ${tauriBin}. Run \"npm ci\" to install dependencies before desktop packaging.`
  );
  process.exit(1);
}

if (variant === 'tech') {
  cliArgs.push('--config', 'src-tauri/tauri.tech.conf.json');
}

if (sign) {
  if (os === 'macos') {
    const hasIdentity = Boolean(env.TAURI_BUNDLE_MACOS_SIGNING_IDENTITY || env.APPLE_SIGNING_IDENTITY);
    const hasProvider = Boolean(env.TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME);
    if (!hasIdentity || !hasProvider) {
      console.error(
        'Signing requested (--sign) but missing macOS signing env vars. Set TAURI_BUNDLE_MACOS_SIGNING_IDENTITY (or APPLE_SIGNING_IDENTITY) and TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME.'
      );
      process.exit(1);
    }
  }

  if (os === 'windows') {
    const hasThumbprint = Boolean(env.TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT);
    const hasPfx = Boolean(env.TAURI_BUNDLE_WINDOWS_CERTIFICATE && env.TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD);
    if (!hasThumbprint && !hasPfx) {
      console.error(
        'Signing requested (--sign) but missing Windows signing env vars. Set TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT or TAURI_BUNDLE_WINDOWS_CERTIFICATE + TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD.'
      );
      process.exit(1);
    }
  }
}

console.log(`[desktop-package] OS=${os} VARIANT=${variant} BUNDLES=${bundles} SIGN=${sign ? 'on' : 'off'}`);

const result = spawnSync(tauriBin, cliArgs, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
