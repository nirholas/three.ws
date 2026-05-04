import { randomBytes } from 'crypto';

/**
 * Generates a random, human-readable referral code.
 * @param {number} length The desired length of the code.
 * @returns {string} A random referral code.
 */
export function generateReferralCode(length = 8) {
  // Using a base32-like alphabet to avoid ambiguous characters (0/O, 1/I/l)
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  const randomValues = randomBytes(length);

  for (let i = 0; i < length; i++) {
    code += alphabet[randomValues[i] % alphabet.length];
  }

  return code;
}
