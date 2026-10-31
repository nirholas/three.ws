import { envelopesIn, readInscription } from '/onchain/inscriptions.js';
const RPC = 'https://api.mainnet-beta.solana.com';
// SPL Memo v1, v2, and the newer program that version-1 transactions use.
const memoPrograms = new Set(['Memo1UhkJRfHyvLMcVLMbLJYfW2tfU8G8H4PqvV6v8', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH']);
const $ = (id) => document.getElementById(id);
const signatureFrom = (value) => {
  const trimmed = value.trim();
  const match = trimmed.match(/(?:solscan\.io\/tx\/)?([1-9A-HJ-NP-Za-km-z]{80,100})/);
  return match ? match[1] : '';
};
const setStatus = (message, error = false) => { $('status').textContent = message; $('status').className = error ? 'error' : ''; };
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const formatTime = (seconds) => seconds ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000)) : 'Unavailable';
function dataUriDetails(value) {
  const match = value.match(/^data:([a-z]+\/[a-z0-9+.-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  // Raster formats only: the data is displayed, never executed as a document.
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) return { unsupported: mime };
  try { return { mime, bytes: atob(match[2].replace(/\s/g, '')).length, uri: value }; } catch { return null; }
}
function render(signature, transaction, memo) {
  const detail = dataUriDetails(memo);
  $('result').classList.add('visible');
  const payer = transaction.transaction.message.accountKeys.find((key) => key.signer)?.pubkey || 'Unavailable';
  $('meta').innerHTML = `<div>Format<strong>${detail?.mime || (detail?.unsupported ? detail.unsupported + ' (not previewed)' : 'Text memo')}</strong></div><div>Written<strong>${formatTime(transaction.blockTime)}</strong></div><div>Signed by<strong>${escape(payer)}</strong></div><div>Transaction<strong><a target="_blank" rel="noopener" href="https://solscan.io/tx/${encodeURIComponent(signature)}">View on Solscan</a></strong></div>`;
  const preview = $('preview'); const actions = $('actions'); preview.replaceChildren(); actions.replaceChildren();
  if (detail?.uri) {
    const image = new Image(); image.src = detail.uri; image.alt = `Onchain ${detail.mime} (${detail.bytes.toLocaleString()} bytes)`; preview.append(image);
    const download = document.createElement('a'); download.href = detail.uri; download.download = `solana-memo-${signature.slice(0, 8)}.${detail.mime.split('/')[1]}`; download.textContent = 'Download file'; download.style.cssText = 'display:inline-block;padding:13px 17px;border-radius:10px;text-decoration:none;background:#26334b;color:#dce7fb'; actions.append(download);
    setStatus(`Found a ${detail.mime} image (${detail.bytes.toLocaleString()} bytes).`);
  } else {
    const text = document.createElement('pre'); text.textContent = memo; preview.append(text);
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary'; copy.textContent = 'Copy memo'; copy.onclick = async () => { await navigator.clipboard.writeText(memo); copy.textContent = 'Copied'; }; actions.append(copy);
    setStatus(detail?.unsupported ? `Found a ${detail.unsupported} payload. This viewer does not preview that format yet.` : 'Found a text memo.');
  }
}
async function rpcCall(method, params) {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const payload = await response.json(); if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}
const getTransaction = (signature) => rpcCall('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
const listSignatures = (address, options) => rpcCall('getSignaturesForAddress', [address, { limit: 1000, ...options }]);
const STATUS_LABEL = { verified: 'Verified: SHA-256 matches the writer\u2019s hash', complete: 'Complete: every part present (this format declares no hash)', incomplete: 'Incomplete: parts are missing', invalid: 'Invalid: checks failed, nothing is shown' };
const PROTOCOL_LABEL = { 'first/1': 'first/1 inscription', 'firsts/1': 'firsts/1 inscription', spl404: 'SPL404 file' };
let objectUrl = null;
const safeFileName = (name, hash, mime) => {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 80);
  return base || `inscription-${hash.slice(0, 8)}.${(mime || 'bin').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
};
function renderInscription(signature, transaction, result) {
  $('result').classList.add('visible');
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  const view = result.presentation;
  const payer = result.signer || transaction.transaction.message.accountKeys.find((key) => key.signer)?.pubkey || 'Unavailable';
  const format = [PROTOCOL_LABEL[result.protocol] || result.protocol, result.type, view?.kind === 'image' ? view.mime : result.mime && view?.kind !== 'text' ? result.mime : null].filter(Boolean).join(' \u00b7 ');
  const cells = [
    ['Format', escape(format)],
    ['Parts', `${result.parts_found} of ${result.parts_total}`],
    ['Status', escape(STATUS_LABEL[result.status] || result.status)],
    ['Signed by', escape(payer)],
    ['Transaction', `<a target="_blank" rel="noopener" href="https://solscan.io/tx/${encodeURIComponent(signature)}">View on Solscan</a>`],
  ];
  if (result.content_sha256) cells.push(['SHA-256 of the file', `<span style="word-break:break-all;font-family:ui-monospace,monospace;font-size:12px">${escape(result.content_sha256)}</span>`]);
  $('meta').innerHTML = cells.map(([label, value]) => `<div>${label}<strong>${value}</strong></div>`).join('');
  const preview = $('preview'); const actions = $('actions'); preview.replaceChildren(); actions.replaceChildren();
  const notes = [];
  if (result.missing?.length) notes.push(`Missing part${result.missing.length > 1 ? 's' : ''} ${result.missing.join(', ')}. Parts are found through the signer\u2019s recent history; older parts may need their own transaction signature.`);
  for (const problem of result.problems || []) notes.push(problem);
  if (notes.length) { const list = document.createElement('ul'); list.className = 'fine'; for (const note of notes) { const li = document.createElement('li'); li.textContent = note; list.append(li); } preview.append(list); }
  if (result.content && view) {
    const hash8 = result.content_sha256.slice(0, 8);
    if (view.kind === 'image') {
      objectUrl = URL.createObjectURL(new Blob([result.content], { type: view.mime }));
      const image = new Image(); image.src = objectUrl; image.alt = `Onchain ${view.mime} (${result.content.length.toLocaleString()} bytes)`; preview.append(image);
    } else if (view.kind === 'text') {
      const text = document.createElement('pre'); text.textContent = view.text; preview.append(text);
      if (view.markup) { const warn = document.createElement('p'); warn.className = 'fine'; warn.textContent = 'This looks like SVG or HTML. It is shown as text only and is never rendered or executed.'; preview.append(warn); }
    } else {
      const note = document.createElement('p'); note.className = 'fine'; note.textContent = `${result.content.length.toLocaleString()} bytes of binary data. No preview; download it to inspect.`; preview.append(note);
    }
    objectUrl = objectUrl || URL.createObjectURL(new Blob([result.content], { type: view.kind === 'image' ? view.mime : 'application/octet-stream' }));
    const download = document.createElement('a'); download.href = objectUrl; download.download = safeFileName(result.name, hash8, view.kind === 'image' ? view.mime : null); download.textContent = `Download file (SHA-256 ${hash8}\u2026)`;
    download.style.cssText = 'display:inline-block;padding:13px 17px;border-radius:10px;text-decoration:none;background:#26334b;color:#dce7fb'; actions.append(download);
  }
  const bad = result.status === 'invalid' || result.status === 'incomplete';
  setStatus(bad ? `${STATUS_LABEL[result.status]}.` : `Rebuilt ${result.content.length.toLocaleString()} bytes from ${result.parts_found} parts. ${STATUS_LABEL[result.status]}.`, bad);
}
async function lookup(event) {
  event?.preventDefault(); const signature = signatureFrom($('transaction').value);
  $('result').classList.remove('visible');
  if (!signature) return setStatus('Enter a valid Solana transaction signature or Solscan transaction link.', true);
  history.replaceState({}, '', `?tx=${encodeURIComponent(signature)}`); setStatus('Reading the signed transaction…');
  try {
    const transaction = await getTransaction(signature); if (!transaction) throw new Error('Transaction was not found on the Solana mainnet.');
    if (envelopesIn(signature, transaction).length) {
      setStatus('Found a multi-part inscription. Collecting and verifying its parts\u2026');
      const result = await readInscription({ signature, getTransaction: (sig) => (sig === signature ? Promise.resolve(transaction) : getTransaction(sig)), listSignatures });
      if (result.status !== 'not_inscription') return renderInscription(signature, transaction, result);
    }
    const instructions = [...transaction.transaction.message.instructions, ...(transaction.meta?.innerInstructions || []).flatMap((group) => group.instructions || [])];
    const memos = instructions.filter((item) => memoPrograms.has(item.programId) && typeof item.parsed === 'string');
    const instruction = memos.find((item) => item.parsed.startsWith('data:')) || memos[0];
    if (!instruction) throw new Error('No readable Memo was found in this transaction.');
    render(signature, transaction, instruction.parsed);
  } catch (error) { setStatus(error.message || 'Could not read that transaction.', true); }
}
$('lookup').addEventListener('submit', lookup);
const initial = new URLSearchParams(location.search).get('tx');
if (initial) { $('transaction').value = initial; lookup(); }
