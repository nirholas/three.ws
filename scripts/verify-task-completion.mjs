#!/usr/bin/env node
// Read-only triage: for every prompt/task file, extract the deliverables it
// declares (new files + new API endpoints) and check whether they exist in the
// repo, plus whether git history references the task. Buckets each file as
// done / pending / review. Heuristic first-pass — evidence is printed so a
// human or a deeper agent pass can adjudicate the "review" set.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['data/reports', 'prompts'].filter(d => existsSync(join(ROOT, d)));
const META = /(README|PLAN|MANIFEST|REPORT|CHECKLIST|PERF_NOTES|START-HERE|_shared|ORPHAN|SIGNERS|overview)/i;

// --- repo ground truth -----------------------------------------------------
const tracked = new Set(
  execSync('git ls-files', { cwd: ROOT, maxBuffer: 1 << 28 }).toString().split('\n').filter(Boolean)
);
const trackedLower = new Set([...tracked].map(s => s.toLowerCase()));
const commitSubjects = execSync('git log --pretty=%s -n 4000', { cwd: ROOT, maxBuffer: 1 << 28 })
  .toString().toLowerCase();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

// Resolve a referenced path or endpoint to "does a real file back it?"
function pathExists(ref) {
  ref = ref.replace(/^\.?\//, '').replace(/`/g, '').trim();
  if (tracked.has(ref) || trackedLower.has(ref.toLowerCase())) return true;
  // extensionless or index resolution
  for (const ext of ['.js', '.ts', '.mjs', '.tsx', '.jsx', '.svelte']) {
    if (tracked.has(ref + ext) || tracked.has(ref + '/index' + ext)) return true;
  }
  return false;
}
function endpointExists(route) {
  // /api/irl/agent-card -> api/irl/agent-card.{js,ts} OR api/irl/[x].js (dynamic)
  const clean = route.replace(/^\//, '').replace(/\?.*$/, '').replace(/`/g, '');
  if (pathExists(clean)) return true;
  const dir = clean.split('/').slice(0, -1).join('/');
  for (const f of tracked) {
    if (f.startsWith(dir + '/[') ) return true; // dynamic route handler in same dir
  }
  return false;
}

const PATH_RE = /`?((?:api|src|workers|sdk|public|pages|data|chat|scripts|solana-agent-sdk|agent-payments-sdk|packages|mcp-server|contracts)\/[A-Za-z0-9_.\/\[\]-]+\.(?:js|ts|jsx|tsx|mjs|svelte|json|sql|html|css))`?/g;
const ENDPOINT_RE = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+`?(\/api\/[A-Za-z0-9_\/\[\]-]+)/g;
const NEW_RE = /\(new\)|new file|\bcreate\b|\badd (?:a )?new/i;

function classify(file) {
  const txt = readFileSync(file, 'utf8');
  const lines = txt.split('\n');
  const refs = new Map();   // path -> {new:bool, exists:bool}
  const eps  = new Map();   // route -> {new:bool, exists:bool}

  for (const line of lines) {
    const isNew = NEW_RE.test(line);
    let m;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(line))) {
      const p = m[1];
      const prev = refs.get(p) || { new: false, exists: pathExists(p) };
      prev.new = prev.new || isNew;
      refs.set(p, prev);
    }
    ENDPOINT_RE.lastIndex = 0;
    while ((m = ENDPOINT_RE.exec(line))) {
      const r = m[1];
      const prev = eps.get(r) || { new: false, exists: endpointExists(r) };
      prev.new = prev.new || isNew;
      eps.set(r, prev);
    }
  }

  const deliverables = [
    ...[...refs].map(([p, v]) => ({ kind: 'file', id: p, ...v })),
    ...[...eps].map(([p, v]) => ({ kind: 'endpoint', id: p, ...v })),
  ];
  const newOnes = deliverables.filter(d => d.new);
  const newMissing = newOnes.filter(d => !d.exists);
  const newExist   = newOnes.filter(d => d.exists);
  const anyExist = deliverables.filter(d => d.exists);
  const anyMissing = deliverables.filter(d => !d.exists);

  // git history hint from the filename slug
  const slug = file.split('/').pop().replace(/\.md$/, '');
  const kw = slug.replace(/^[0-9A-Za-z]+[-_]/, '').split(/[-_]/).filter(w => w.length > 3);
  const gitHits = kw.filter(w => commitSubjects.includes(w.toLowerCase())).length;
  const gitSignal = kw.length ? gitHits / kw.length : 0;

  let bucket, why;
  if (newOnes.length) {
    if (newMissing.length === 0) { bucket = 'DONE'; why = `all ${newOnes.length} new deliverable(s) exist`; }
    else if (newExist.length === 0) { bucket = 'PENDING'; why = `all ${newMissing.length} new deliverable(s) missing`; }
    else { bucket = 'REVIEW'; why = `${newExist.length} exist / ${newMissing.length} missing of new deliverables`; }
  } else if (deliverables.length) {
    // edits to existing files only — existence proves nothing; lean on git
    if (gitSignal >= 0.5) { bucket = 'DONE'; why = `edits-only; git history matches slug (${gitHits}/${kw.length})`; }
    else if (anyMissing.length && !anyExist.length) { bucket = 'PENDING'; why = `all referenced paths missing`; }
    else { bucket = 'REVIEW'; why = `edits existing files; needs behavior check`; }
  } else {
    bucket = gitSignal >= 0.6 ? 'DONE' : 'REVIEW';
    why = deliverables.length ? '' : `no parseable deliverables (git slug match ${gitHits}/${kw.length})`;
  }

  return {
    file: relative(ROOT, file), bucket, why,
    newExist: newExist.length, newMissing: newMissing.map(d => d.id),
    refTotal: deliverables.length, refMissing: anyMissing.map(d => d.id), gitSignal: +gitSignal.toFixed(2),
  };
}

const results = [];
for (const r of ROOTS)
  for (const f of walk(join(ROOT, r))) {
    if (META.test(f.split('/').pop())) continue;
    results.push(classify(f));
  }

const by = b => results.filter(r => r.bucket === b);
mkdirSync(join(ROOT, 'reports'), { recursive: true });
writeFileSync(join(ROOT, 'reports/task-completion.json'), JSON.stringify(results, null, 2));
const csv = ['file,bucket,why,gitSignal,newMissing,refMissing',
  ...results.map(r => [r.file, r.bucket, JSON.stringify(r.why), r.gitSignal,
    JSON.stringify(r.newMissing.join('; ')), JSON.stringify(r.refMissing.slice(0,5).join('; '))].join(','))].join('\n');
writeFileSync(join(ROOT, 'reports/task-completion.csv'), csv);

console.log(`total=${results.length}  DONE=${by('DONE').length}  PENDING=${by('PENDING').length}  REVIEW=${by('REVIEW').length}`);
console.log('\n--- PENDING (sample, deliverables missing) ---');
by('PENDING').slice(0, 15).forEach(r => console.log(`  ${r.file}\n      ${r.why}${r.newMissing.length ? ' :: '+r.newMissing.join(', ') : ''}`));
console.log('\n--- DONE (sample) ---');
by('DONE').slice(0, 12).forEach(r => console.log(`  ${r.file}  (${r.why})`));
console.log(`\nFull report: reports/task-completion.csv  +  reports/task-completion.json`);
