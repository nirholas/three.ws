// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// X/Twitter Space UI selectors
// Isolated here so they're easy to update when X changes their DOM

export const selectors = {
  // Login flow
  LOGIN_USERNAME_INPUT: 'input[autocomplete="username"]',
  LOGIN_NEXT_BUTTON: 'button:has-text("Next"), [role="button"] span:has-text("Next")',
  LOGIN_PASSWORD_INPUT: 'input[name="password"], input[type="password"]',
  LOGIN_SUBMIT_BUTTON: '[data-testid="LoginForm_Login_Button"]',
  VERIFY_EMAIL_INPUT: 'input[data-testid="ocfEnterTextTextInput"]',
  VERIFY_NEXT_BUTTON: '[data-testid="ocfEnterTextNextButton"]',

  // Home feed (confirms login success)
  HOME_TIMELINE: '[data-testid="primaryColumn"]',
  HOME_URL: "https://x.com/home",

  // Space UI
  SPACE_JOIN_BUTTON: 'button[aria-label="Start listening"], [data-testid="SpaceJoinButton"], button[aria-label*="listen" i], button[aria-label*="join" i], button[aria-label*="tune in" i]',
  SPACE_REQUEST_SPEAK: 'button[aria-label="Request to speak"], button[aria-label*="Request"], [data-testid="SpaceRequestToSpeakButton"], button[aria-label*="request to speak"], button[aria-label*="Raise hand"], button[aria-label*="Ask to speak"]',
  SPACE_UNMUTE_BUTTON: 'button[aria-label="Unmute"], button[aria-label*="Unmute"], button[aria-label*="unmute"], [data-testid="SpaceMuteButton"], [data-testid="SpaceUnmuteButton"], button[aria-label*="Turn on microphone"], button[aria-label*="Start speaking"]',
  SPACE_MUTE_BUTTON: 'button[aria-label="Mute"], button[aria-label*="Mute"], [data-testid="SpaceMuteButton"], button[aria-label*="Turn off microphone"]',
  SPACE_LEAVE_BUTTON: '[data-testid="SpaceLeaveButton"], button[aria-label*="leave" i]',
  SPACE_DOCK: '[data-testid="SpaceDockExpanded"], [data-testid="SpaceDockCollapsed"]',
  SPACE_MIC_BUTTON: 'button[aria-label="Unmute"], button[aria-label="Mute"], button[aria-label*="microphone"], button[aria-label*="Microphone"], [data-testid="SpaceMuteButton"], [data-testid="SpaceUnmuteButton"]',
  SPACE_SPEAKER_LIST: '[data-testid="SpaceSpeakerAvatar"]',

  // Space state detection
  SPACE_ENDED_TEXT: 'span:has-text("This Space has ended"), span:has-text("Space ended")',
  SPACE_LIVE_INDICATOR: 'span:has-text("LIVE"), [data-testid="SpaceLiveIndicator"]',
} as const

export type SelectorKey = keyof typeof selectors


