// The conference-kiosk lane for the browser digital human.
//
// A booth device runs /audio2face?kiosk=1 unattended all day, serving a queue
// of visitors from one IP. The anonymous per-IP buckets (sized for one person
// trying the demo) would silence it within minutes. The booth operator sets
// DIGITAL_HUMAN_KIOSK_KEY on the deployment and opens the kiosk once with
// ?kiosk=1&key=<value>; the page keeps the key in the device's localStorage
// and sends it as `x-kiosk-key`. A matching key moves the request to the
// finite digitalHumanKiosk bucket. No key configured means the lane is off.

import { timingSafeEqual, createHash } from 'node:crypto';
import { env } from './env.js';

const digest = (s) => createHash('sha256').update(String(s)).digest();

/** True when the request carries the configured booth key. Constant-time. */
export function isKioskRequest(req) {
	const configured = env.DIGITAL_HUMAN_KIOSK_KEY;
	if (!configured) return false;
	const sent = req?.headers?.['x-kiosk-key'];
	if (typeof sent !== 'string' || !sent) return false;
	return timingSafeEqual(digest(sent), digest(configured));
}

/** The limiter key for a kiosk request: one bucket per configured key. */
export function kioskBucketKey() {
	return `kiosk:${digest(env.DIGITAL_HUMAN_KIOSK_KEY || '')
		.toString('hex')
		.slice(0, 16)}`;
}
