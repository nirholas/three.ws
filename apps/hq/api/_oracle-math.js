/** Pure oracle-comparison math. No I/O, so it is unit-tested directly. */

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** Signed deviation of `value` from `reference`, in basis points. */
export function deviationBps(value, reference) {
  if (!fin(value) || !fin(reference) || reference === 0) return null;
  return Math.round(((value - reference) / reference) * 1e6) / 100;
}

/** True when a round is older than its heartbeat plus 10% grace; null when unknown. */
export function isStale({ updatedAtSec, heartbeatSec, nowSec }) {
  if (!fin(updatedAtSec) || !fin(heartbeatSec) || !fin(nowSec)) return null;
  return nowSec - updatedAtSec > heartbeatSec * 1.1;
}

export function classifyFeed({ bps, stale, thresholdBps }) {
  if (stale) return 'stale';
  if (!fin(bps)) return 'unknown';
  return Math.abs(bps) > thresholdBps ? 'deviation' : 'ok';
}

export function median(values) {
  const v = values.filter(fin).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function pythToNumber({ price, expo }) {
  const n = Number(price);
  return fin(n) && fin(expo) ? n * 10 ** expo : null;
}

export function chainlinkToNumber(answer, decimals) {
  const n = Number(answer);
  return fin(n) && fin(decimals) ? n / 10 ** decimals : null;
}

/**
 * Decode a Pyth PriceUpdateV2 account (the layout Solana programs read):
 * 8-byte discriminator, 32-byte write authority, a verification-level enum
 * (Partial = tag 0 + 1 byte, Full = tag 1), then the price message.
 */
export function parsePythPriceUpdate(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (b.length < 42) return null;
  const msg = 40 + (b[40] === 0 ? 2 : 1);
  if (b.length < msg + 60) return null;
  const price = pythToNumber({ price: b.readBigInt64LE(msg + 32).toString(), expo: b.readInt32LE(msg + 48) });
  if (!fin(price)) return null;
  return { feedId: b.subarray(msg, msg + 32).toString('hex'), price, publishTimeSec: Number(b.readBigInt64LE(msg + 52)) };
}
