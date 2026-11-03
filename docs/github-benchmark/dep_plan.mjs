// Plan and check same-major security overrides for one lockfile.
//
//   node dep_plan.mjs plan  <dir> <kind> <alerts.json>   -> {overrides, unfixable, open}
//   node dep_plan.mjs check <dir> <kind> <alerts.json>   -> {open, openAlerts}
//
// kind: npm | pnpm | yarn | cargo. alerts.json: [{pkg, range, patched}] in Dependabot's
// range format (">= 4.0.0, < 4.2.4"). An alert counts as open while any version installed
// in the lockfile falls inside its vulnerable range. Overrides only move a package to the
// highest non-vulnerable version inside the major (or 0.minor) it is already on, so no
// parent sees an API it was not built against.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const semver = createRequire(join(npmRoot, 'npm', 'package.json'))('semver');
const [, , mode, dir, kind, alertsFile] = process.argv;
const alerts = JSON.parse(readFileSync(alertsFile, 'utf8')).map((a) => ({ ...a, ranges: (a.ranges || [a.range]).map((r) => r.split(',').map((p) => p.trim().replace(/^(>=|<=|>|<|=)\s+/, '$1')).join(' ')) }));

function installed() {
  const v = new Map();
  const add = (name, ver) => {
    const c = semver.valid(ver) || semver.valid(semver.coerce(ver));
    if (!c) return;
    if (!v.has(name)) v.set(name, new Set());
    v.get(name).add(c);
  };
  if (kind === 'npm') {
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    for (const [key, meta] of Object.entries(lock.packages || {})) {
      const i = key.lastIndexOf('node_modules/');
      if (i >= 0 && meta.version) add(meta.name || key.slice(i + 13), meta.version);
    }
    const walk = (deps) => {
      for (const [n, m] of Object.entries(deps || {})) {
        if (m.version) add(n, m.version);
        walk(m.dependencies);
      }
    };
    walk(lock.dependencies);
  } else if (kind === 'pnpm') {
    const text = readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8');
    const body = text.split(/^(?:packages|snapshots):\s*$/m).slice(1).join('\n');
    for (const m of body.matchAll(/^ {2}['"]?\/?((?:@[^/@\s'"]+\/)?[^/@\s'"(]+)[@/](\d[^:('"\s]*)/gm)) add(m[1], m[2]);
  } else if (kind === 'yarn') {
    const text = readFileSync(join(dir, 'yarn.lock'), 'utf8');
    for (const block of text.split(/\n(?=\S)/)) {
      const head = block.split('\n')[0];
      const name = head.replace(/^"/, '').match(/^((?:@[^/@]+\/)?[^@]+)@/);
      const ver = block.match(/\n\s+version:?\s+"?([^"\n]+)"?/);
      if (name && ver) add(name[1], ver[1]);
    }
  } else if (kind === 'cargo') {
    const text = readFileSync(join(dir, 'Cargo.lock'), 'utf8');
    for (const m of text.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)) add(m[1], m[2]);
  }
  return v;
}

const inst = installed();
const hit = (ver, ranges) => ranges.some((r) => semver.satisfies(ver, r, { includePrerelease: true }));
const openAlerts = alerts.filter((a) => [...(inst.get(a.pkg) || [])].some((ver) => hit(ver, a.ranges)));

if (mode === 'check') {
  console.log(JSON.stringify({ open: openAlerts.length, openAlerts: openAlerts.map((a) => `${a.pkg} ${a.ranges.join(' || ')}`) }));
  process.exit(0);
}

const byPkg = new Map();
for (const a of openAlerts) {
  if (!byPkg.has(a.pkg)) byPkg.set(a.pkg, []);
  byPkg.get(a.pkg).push(...a.ranges);
}
const groupOf = (ver) => (semver.major(ver) === 0 ? `0.${semver.minor(ver)}` : `${semver.major(ver)}`);
const overrides = {};
const unfixable = [];
const vulnerableVersions = {};
for (const [pkg, ranges] of byPkg) {
  const vulnerable = [...inst.get(pkg)].filter((ver) => hit(ver, ranges));
  vulnerableVersions[pkg] = vulnerable;
  let published;
  try {
    if (kind === 'cargo') {
      const r = await fetch(`https://crates.io/api/v1/crates/${pkg}/versions`, { headers: { 'User-Agent': 'dep-plan (security override planner)' } });
      published = (await r.json()).versions.filter((v) => !v.yanked).map((v) => v.num);
    } else {
      published = JSON.parse(execFileSync('npm', ['view', pkg, 'versions', '--json'], { encoding: 'utf8', timeout: 60000 }));
      if (!Array.isArray(published)) published = [published];
    }
  } catch {
    unfixable.push(`${pkg}: registry lookup failed`);
    continue;
  }
  for (const group of new Set(vulnerable.map(groupOf))) {
    const inGroup = published.filter((p) => semver.valid(p) && !semver.prerelease(p) && groupOf(p) === group);
    const floor = semver.maxSatisfying(vulnerable.filter((v) => groupOf(v) === group), '*', { includePrerelease: true });
    const best = semver.maxSatisfying(inGroup.filter((p) => semver.gt(p, floor) && !ranges.some((r) => semver.satisfies(p, r))), '*');
    // A caret is only safe when nothing newer in the group is vulnerable; otherwise pin exactly.
    const newest = semver.maxSatisfying(inGroup, '*');
    if (best) overrides[`${pkg}@${group}`] = best === newest ? (group.startsWith('0.') ? `~${best}` : `^${best}`) : best;
    else unfixable.push(`${pkg}@${group}.x: no patched release in this ${group.startsWith('0.') ? 'minor' : 'major'}; upgrade the parent that pins it`);
  }
}
const installedGroups = Object.fromEntries([...byPkg.keys()].map((p) => [p, new Set([...inst.get(p)].map(groupOf)).size]));
console.log(JSON.stringify({ open: openAlerts.length, overrides, unfixable, vulnerableVersions, installedGroups }));
