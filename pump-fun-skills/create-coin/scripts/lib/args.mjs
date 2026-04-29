import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";

/**
 * @param {string} label
 * @param {string | undefined} value
 * @returns {string}
 */
export function requireString(label, value) {
  if (value == null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
}

/**
 * @param {string} label
 * @param {string | undefined} value
 * @returns {import("@solana/web3.js").PublicKey}
 */
export function requirePublicKey(label, value) {
  const s = requireString(label, value);
  try {
    return new PublicKey(s);
  } catch {
    throw new Error(`${label} is not a valid base58 public key: ${s}`);
  }
}

/**
 * @param {string | undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
export function parsePositiveInt(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected positive integer, got: ${value}`);
  }
  return n;
}

/**
 * @param {string | undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
export function parseSlippagePercent(value, defaultValue = 10) {
  if (value == null || value === "") return defaultValue;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`Slippage must be 0–100 (percent), got: ${value}`);
  }
  return n;
}

/**
 * @param {Record<string, unknown>} obj
 */
export function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 0)}\n`);
}

/**
 * @param {string} name
 * @param {string} body
 */
export function exitWithHelp(name, body) {
  process.stderr.write(`${name}\n\n${body}\n`);
  process.exit(0);
}

export { parseArgs };
