// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

// =============================================================================
// Referral Program — Track referrals, credits, and conversions
// =============================================================================

import { randomBytes } from 'crypto';
import type { OrgId, UserId } from '../tenant/types';
import type { Referral, ReferralStatus, ReferralSummary } from './types';

/** Credit amount in cents for a successful referral conversion. */
export const REFERRAL_CREDIT_CENTS = 1000; // $10

/** Days before an unclaimed referral expires. */
export const REFERRAL_EXPIRY_DAYS = 90;

/** In-memory referral store (migrate to DB later). */
const referralStore = new Map<string, Referral>();
const referralsByCode = new Map<string, string>(); // code -> referral ID
const userReferralCodes = new Map<string, string>(); // userId -> referral code

/** Generate a unique referral code for a user. */
export function getOrCreateReferralCode(userId: UserId): string {
  if (userReferralCodes.has(userId)) {
    return userReferralCodes.get(userId)!;
  }
  const code = randomBytes(6).toString('base64url');
  userReferralCodes.set(userId, code);
  return code;
}

/** Create a referral when a user shares their link. */
export function createReferral(
  referrerId: UserId,
  referrerOrgId: OrgId,
  referredEmail?: string
): Referral {
  const code = getOrCreateReferralCode(referrerId);
  const id = randomBytes(16).toString('hex');

  const referral: Referral = {
    id,
    referrerId,
    referrerOrgId,
    code,
    referredEmail,
    status: 'pending',
    creditCents: 0,
    creditApplied: false,
    createdAt: new Date(),
  };

  referralStore.set(id, referral);
  referralsByCode.set(code, id);
  return referral;
}

/** Look up a referral by its code. */
export function getReferralByCode(code: string): Referral | undefined {
  const id = referralsByCode.get(code);
  if (!id) return undefined;
  return referralStore.get(id);
}

/** Get a referral by ID. */
export function getReferral(id: string): Referral | undefined {
  return referralStore.get(id);
}

/** Update referral status when the referred user signs up. */
export function markReferralSignedUp(
  code: string,
  referredUserId: UserId,
  referredOrgId: OrgId
): Referral | undefined {
  const id = referralsByCode.get(code);
  if (!id) return undefined;
  const referral = referralStore.get(id);
  if (!referral || referral.status !== 'pending') return undefined;

  referral.status = 'signed_up';
  referral.referredUserId = referredUserId;
  referral.referredOrgId = referredOrgId;
  referral.signedUpAt = new Date();
  return referral;
}

/** Mark a referral as converted (referred user upgraded to paid). */
export function markReferralConverted(referredOrgId: OrgId): Referral | undefined {
  // Find the referral by the referred org
  for (const referral of referralStore.values()) {
    if (referral.referredOrgId === referredOrgId && referral.status === 'signed_up') {
      referral.status = 'converted';
      referral.convertedAt = new Date();
      referral.creditCents = REFERRAL_CREDIT_CENTS;
      return referral;
    }
  }
  return undefined;
}

/** Mark a referral's credit as applied to the referrer's account. */
export function applyReferralCredit(referralId: string): boolean {
  const referral = referralStore.get(referralId);
  if (!referral || referral.status !== 'converted' || referral.creditApplied) return false;
  referral.creditApplied = true;
  return true;
}

/** Get all referrals made by a user. */
export function getUserReferrals(userId: UserId): Referral[] {
  return Array.from(referralStore.values()).filter((r) => r.referrerId === userId);
}

/** Build a referral summary for a user. */
export function getReferralSummary(userId: UserId): ReferralSummary {
  const referrals = getUserReferrals(userId);
  const conversions = referrals.filter((r) => r.status === 'converted');
  const totalCreditsCents = conversions.reduce((sum, r) => sum + r.creditCents, 0);
  const pendingCreditsCents = conversions
    .filter((r) => !r.creditApplied)
    .reduce((sum, r) => sum + r.creditCents, 0);

  return {
    userId,
    referralCode: getOrCreateReferralCode(userId),
    totalReferrals: referrals.length,
    conversions: conversions.length,
    totalCreditsCents,
    pendingCreditsCents,
  };
}

/** Expire old pending referrals. Returns number of expired referrals. */
export function expireOldReferrals(now?: Date): number {
  const currentTime = now ?? new Date();
  const expiryMs = REFERRAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  let count = 0;

  for (const referral of referralStore.values()) {
    if (
      referral.status === 'pending' &&
      currentTime.getTime() - referral.createdAt.getTime() > expiryMs
    ) {
      referral.status = 'expired';
      count++;
    }
  }

  return count;
}

/** Clear referral data for an org (for testing or org deletion). */
export function clearReferrals(userId: UserId): void {
  const code = userReferralCodes.get(userId);
  if (code) {
    referralsByCode.delete(code);
    userReferralCodes.delete(userId);
  }
  for (const [id, referral] of referralStore.entries()) {
    if (referral.referrerId === userId) {
      referralStore.delete(id);
    }
  }
}


