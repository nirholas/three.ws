/**
 * Single source of truth for plan tiers and entitlements.
 * Adding a new entitlement here automatically gates it on the server and client.
 */

export type PlanId = "free" | "pro";

export interface PlanEntitlements {
  /** Number of avatar characters the user can select */
  avatarCount: number;
  /** Can capture AR photos to disk */
  canCapturePhotos: boolean;
  /** Watermark on captured photos */
  watermark: boolean;
  /** Can record AR videos */
  canRecordVideo: boolean;
  /** Max photo resolution (long edge in pixels) */
  maxCaptureRes: number;
}

export const PLANS: Record<PlanId, { name: string; price: number; entitlements: PlanEntitlements }> = {
  free: {
    name: "Free",
    price: 0,
    entitlements: {
      avatarCount: 1,
      canCapturePhotos: true,
      watermark: true,
      canRecordVideo: false,
      maxCaptureRes: 1080,
    },
  },
  pro: {
    name: "Pro",
    price: 9,
    entitlements: {
      avatarCount: 4,
      canCapturePhotos: true,
      watermark: false,
      canRecordVideo: true,
      maxCaptureRes: 2160,
    },
  },
};

/** Active statuses that grant entitlements. Anything else falls back to free. */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function isSubscriptionActive(opts: {
  status?: string | null;
  currentPeriodEnd?: Date | null;
}): boolean {
  if (!opts.status) return false;
  if (!ACTIVE_STATUSES.has(opts.status)) return false;
  if (!opts.currentPeriodEnd) return false;
  return opts.currentPeriodEnd.getTime() > Date.now();
}
