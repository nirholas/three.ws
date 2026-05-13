// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import type { SelectorChain } from "../types.js";

// X/Twitter Space UI selectors — centralized for easy updates when X changes DOM.
// Each action has a primary CSS selector, fallback selectors, and text-based search options.

export const SELECTORS = {
  // Login flow
  LOGIN_USERNAME_INPUT: 'input[autocomplete="username"]',
  LOGIN_PASSWORD_INPUT: 'input[name="password"], input[type="password"]',
  LOGIN_SUBMIT_BUTTON: '[data-testid="LoginForm_Login_Button"]',
  VERIFY_INPUT: 'input[data-testid="ocfEnterTextTextInput"]',
  VERIFY_NEXT_BUTTON: '[data-testid="ocfEnterTextNextButton"]',

  // Home (confirms login)
  HOME_URL: "https://x.com/home",

  // Space UI — selector chains with fallbacks
  spaceJoin: {
    primary:
      'button[aria-label="Start listening"], [data-testid="SpaceJoinButton"], button[aria-label*="listen" i], button[aria-label*="join" i]',
    fallbacks: [
      'button[aria-label="Start listening"]',
      'button[data-testid="SpaceJoinButton"]',
      'button[aria-label*="tune in" i]',
      'button[aria-label="Join this Space"]',
    ],
    textOptions: [
      "Start listening",
      "Listen",
      "Join",
      "Join this Space",
      "Tune in",
    ],
  } satisfies SelectorChain,

  spaceRequestSpeak: {
    primary:
      'button[aria-label="Request to speak"], button[aria-label*="Request"]',
    fallbacks: [
      'button[aria-label="Request to speak"]',
      'button[data-testid="SpaceRequestToSpeakButton"]',
      'button[aria-label*="request to speak"]',
      'button[aria-label*="Raise hand"]',
      'button[aria-label*="Ask to speak"]',
    ],
    textOptions: ["Request to speak", "Request", "request to speak"],
  } satisfies SelectorChain,

  spaceMic: {
    primary:
      'button[aria-label="Unmute"], button[aria-label="Mute"], button[aria-label*="microphone"], button[aria-label*="Microphone"]',
    fallbacks: [
      'button[aria-label="Unmute"]',
      'button[aria-label="Mute"]',
      '[data-testid="SpaceMuteButton"]',
      '[data-testid="SpaceUnmuteButton"]',
      'button[aria-label*="Turn on microphone"]',
      'button[aria-label*="Turn off microphone"]',
    ],
    textOptions: ["Unmute", "Mute"],
  } satisfies SelectorChain,

  spaceLeave: {
    primary:
      '[data-testid="SpaceLeaveButton"], button[aria-label*="Leave"]',
    fallbacks: [
      'button[data-testid="SpaceLeaveButton"]',
      'button[aria-label="Leave quietly"]',
    ],
    textOptions: ["Leave", "Leave quietly", "leave"],
  } satisfies SelectorChain,

  // Space state detection
  SPACE_LIVE_INDICATOR: '[data-testid="SpaceLiveIndicator"]',
  SPACE_SPEAKER_AVATAR: '[data-testid="SpaceSpeakerAvatar"]',
} as const;

/**
 * Resolve a selector chain to a flat list of CSS selectors to try, in priority order.
 */
export function resolveSelectors(chain: SelectorChain): string[] {
  return [chain.primary, ...chain.fallbacks];
}


