'use strict';

// bigint-buffer <= 1.1.5 converts through a native addon whose toBigInt reads
// past the end of short buffers (CVE-2025-3194 / GHSA-3gc7-fjrx-p6mg). Upstream
// has no patched release, so this vendored copy keeps the public API and only
// uses the pure-JS conversions, with the input checks the addon was missing.

Object.defineProperty(exports, '__esModule', { value: true });

function toBuffer(buf) {
  if (Buffer.isBuffer(buf)) return buf;
  if (buf instanceof Uint8Array) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  throw new TypeError('bigint-buffer: expected a Buffer or Uint8Array');
}

function checkWidth(width) {
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new RangeError('bigint-buffer: width must be a non-negative integer');
  }
}

function toHex(num, width) {
  if (typeof num !== 'bigint') throw new TypeError('bigint-buffer: expected a bigint');
  if (num < BigInt(0)) throw new RangeError('bigint-buffer: negative values are not supported');
  return num.toString(16).padStart(width * 2, '0').slice(0, width * 2);
}

/**
 * Convert a little-endian buffer into a BigInt.
 * @param buf The little-endian buffer to convert
 * @returns A BigInt with the little-endian representation of buf.
 */
function toBigIntLE(buf) {
  const reversed = Buffer.from(toBuffer(buf));
  reversed.reverse();
  const hex = reversed.toString('hex');
  return hex.length === 0 ? BigInt(0) : BigInt(`0x${hex}`);
}
exports.toBigIntLE = toBigIntLE;

/**
 * Convert a big-endian buffer into a BigInt
 * @param buf The big-endian buffer to convert.
 * @returns A BigInt with the big-endian representation of buf.
 */
function toBigIntBE(buf) {
  const hex = toBuffer(buf).toString('hex');
  return hex.length === 0 ? BigInt(0) : BigInt(`0x${hex}`);
}
exports.toBigIntBE = toBigIntBE;

/**
 * Convert a BigInt to a little-endian buffer.
 * @param num   The BigInt to convert.
 * @param width The number of bytes that the resulting buffer should be.
 * @returns A little-endian buffer representation of num.
 */
function toBufferLE(num, width) {
  checkWidth(width);
  const buffer = Buffer.from(toHex(num, width), 'hex');
  buffer.reverse();
  return buffer;
}
exports.toBufferLE = toBufferLE;

/**
 * Convert a BigInt to a big-endian buffer.
 * @param num   The BigInt to convert.
 * @param width The number of bytes that the resulting buffer should be.
 * @returns A big-endian buffer representation of num.
 */
function toBufferBE(num, width) {
  checkWidth(width);
  return Buffer.from(toHex(num, width), 'hex');
}
exports.toBufferBE = toBufferBE;
