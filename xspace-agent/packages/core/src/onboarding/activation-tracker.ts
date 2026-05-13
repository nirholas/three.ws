// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Activation Tracker — Track and query "aha moment" events
// =============================================================================

import type { OrgId, UserId } from '../tenant/types';
import type { ActivationEvent, ActivationRecord, ActivationSummary } from './types';

/** All tracked activation events in order of importance. */
export const ACTIVATION_EVENTS: ActivationEvent[] = [
  'agent_created',
  'first_session_completed',
  'agent_first_spoke',
  'teammate_invited',
  'webhook_connected',
  'session_30_minutes',
];

/** In-memory activation store (migrate to DB later). */
const activationStore = new Map<string, ActivationRecord[]>();

function storeKey(orgId: OrgId): string {
  return orgId;
}

/** Record an activation event. Idempotent — duplicate events are ignored. */
export function trackActivation(
  event: ActivationEvent,
  userId: UserId,
  orgId: OrgId,
  metadata?: Record<string, unknown>
): ActivationRecord | null {
  const key = storeKey(orgId);
  if (!activationStore.has(key)) {
    activationStore.set(key, []);
  }

  const records = activationStore.get(key)!;

  // Idempotent: skip if already recorded
  if (records.some((r) => r.event === event)) {
    return null;
  }

  const record: ActivationRecord = {
    event,
    userId,
    orgId,
    occurredAt: new Date(),
    metadata,
  };

  records.push(record);
  return record;
}

/** Get all activation records for an org. */
export function getActivationRecords(orgId: OrgId): ActivationRecord[] {
  return activationStore.get(storeKey(orgId)) ?? [];
}

/** Get the list of achieved activation events for an org. */
export function getAchievedActivations(orgId: OrgId): ActivationEvent[] {
  const records = activationStore.get(storeKey(orgId)) ?? [];
  return records.map((r) => r.event);
}

/** Build an activation summary for an org. */
export function getActivationSummary(
  orgId: OrgId,
  signupTime?: Date
): ActivationSummary {
  const records = activationStore.get(storeKey(orgId)) ?? [];
  const achieved = records.map((r) => r.event);
  const pending = ACTIVATION_EVENTS.filter((e) => !achieved.includes(e));
  const score = ACTIVATION_EVENTS.length > 0
    ? Math.round((achieved.length / ACTIVATION_EVENTS.length) * 100)
    : 0;

  let timeToFirstActivation: number | undefined;
  if (signupTime && records.length > 0) {
    const firstRecord = records.reduce((earliest, r) =>
      r.occurredAt < earliest.occurredAt ? r : earliest
    );
    timeToFirstActivation = firstRecord.occurredAt.getTime() - signupTime.getTime();
  }

  return {
    orgId,
    achieved,
    pending,
    score,
    timeToFirstActivation,
  };
}

/** Check if a specific activation event has been achieved. */
export function hasActivation(orgId: OrgId, event: ActivationEvent): boolean {
  const records = activationStore.get(storeKey(orgId)) ?? [];
  return records.some((r) => r.event === event);
}

/** Clear activation data for an org (for testing or org deletion). */
export function clearActivations(orgId: OrgId): void {
  activationStore.delete(storeKey(orgId));
}


