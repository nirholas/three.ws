// What each chat platform on the agent gateway can do. One table, read by the
// gateway core (reply codes on channels without buttons, status lines only where
// a message can be edited), the notification fan-out (which preference column a
// platform delivers under) and the connections API (how the settings page
// describes each platform). docs/chat-gateways.md renders the same facts.

/**
 * @typedef {object} PlatformInfo
 * @property {string}  label          how the UI names it
 * @property {boolean} buttons        Approve / Cancel render as tappable buttons
 * @property {boolean} canEdit        a sent message can be edited in place
 * @property {boolean} voice          inbound voice notes and spoken replies
 * @property {string|null} notifyChannel  the notify-prefs column it delivers under, null when it never carries notifications
 */

/** @type {Record<string, PlatformInfo>} */
export const PLATFORM_INFO = Object.freeze({
	telegram: { label: 'Telegram', buttons: true, canEdit: true, voice: true, notifyChannel: 'telegram' },
	discord: { label: 'Discord', buttons: true, canEdit: true, voice: true, notifyChannel: 'discord' },
	slack: { label: 'Slack', buttons: true, canEdit: true, voice: true, notifyChannel: 'chat' },
	whatsapp: { label: 'WhatsApp', buttons: true, canEdit: false, voice: true, notifyChannel: 'chat' },
	signal: { label: 'Signal', buttons: false, canEdit: false, voice: true, notifyChannel: 'chat' },
	sms: { label: 'SMS', buttons: false, canEdit: false, voice: false, notifyChannel: 'chat' },
	// The owner's own inbox already receives the `email` notification channel,
	// so an email chat never doubles it.
	email: { label: 'Email', buttons: false, canEdit: false, voice: true, notifyChannel: null },
});

export const PLATFORMS = Object.freeze(Object.keys(PLATFORM_INFO));

export function isPlatform(p) {
	return Object.prototype.hasOwnProperty.call(PLATFORM_INFO, p);
}

export function platformInfo(p) {
	return PLATFORM_INFO[p] || null;
}

/** Platforms that deliver notifications under a given notify-prefs column. */
export function platformsForNotifyChannel(channel) {
	return PLATFORMS.filter((p) => PLATFORM_INFO[p].notifyChannel === channel);
}
