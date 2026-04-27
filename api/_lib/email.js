// Transactional email via Resend. All sends are fire-and-forget — never await
// them on the critical path. Import sendEmail and call without await.
//
// Required env: RESEND_API_KEY, EMAIL_FROM (e.g. "three.ws <noreply@3dagent.xyz>")
// Optional env: EMAIL_REPLY_TO

import { Resend } from 'resend';

let _client = null;
function client() {
	if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
	return _client;
}

const FROM    = process.env.EMAIL_FROM    || 'three.ws <noreply@3dagent.xyz>';
const REPLY   = process.env.EMAIL_REPLY_TO || null;
const APP_URL = process.env.APP_ORIGIN    || 'https://3dagent.xyz';

// ─── Low-level send ───────────────────────────────────────────────────────────

export async function sendEmail({ to, subject, html, text }) {
	if (!process.env.RESEND_API_KEY) return; // no-op if not configured
	try {
		await client().emails.send({
			from: FROM,
			...(REPLY ? { replyTo: REPLY } : {}),
			to,
			subject,
			html,
			text,
		});
	} catch (err) {
		console.error('[email] send failed', err?.message);
	}
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function sendWelcomeEmail({ to, displayName }) {
	const name = displayName || 'there';
	return sendEmail({
		to,
		subject: 'Welcome to three.ws',
		html: welcomeHtml(name),
		text: welcomeText(name),
	});
}

export function sendVerificationEmail({ to, code, expiresInMinutes = 30 }) {
	return sendEmail({
		to,
		subject: `${code} — verify your email`,
		html: verifyHtml(code, expiresInMinutes),
		text: verifyText(code, expiresInMinutes),
	});
}

export function sendPasswordResetEmail({ to, resetUrl, expiresInMinutes = 60 }) {
	return sendEmail({
		to,
		subject: 'Reset your three.ws password',
		html: resetHtml(resetUrl, expiresInMinutes),
		text: resetText(resetUrl, expiresInMinutes),
	});
}

export function sendSubscriptionConfirmEmail({ to, plan, chain, txId }) {
	return sendEmail({
		to,
		subject: `three.ws ${capitalize(plan)} plan activated`,
		html: subscriptionHtml(plan, chain, txId),
		text: subscriptionText(plan, chain, txId),
	});
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function layout(body) {
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,system-ui,'Segoe UI',sans-serif;background:#080814;color:#eee;margin:0;padding:32px 16px}
  .card{max-width:520px;margin:0 auto;background:#14141c;border:1px solid #2a2a36;border-radius:16px;padding:36px 32px}
  .brand{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#6a5cff;margin:0 0 20px}
  h1{font-size:22px;margin:0 0 12px;letter-spacing:-.01em}
  p{color:#aaa;line-height:1.6;margin:0 0 16px;font-size:15px}
  .btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#6a5cff,#ff5ca8);color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;margin:8px 0 20px}
  .code{font-family:monospace;font-size:32px;letter-spacing:.15em;color:#fff;background:#0f0f17;border:1px solid #2a2a36;border-radius:8px;padding:12px 20px;display:inline-block;margin:8px 0 20px}
  .muted{color:#555;font-size:13px}
  hr{border:none;border-top:1px solid #2a2a36;margin:24px 0}
</style></head>
<body><div class="card">${body}</div></body></html>`;
}

function welcomeHtml(name) {
	return layout(`
    <p class="brand">three.ws</p>
    <h1>Welcome, ${esc(name)} 👋</h1>
    <p>Your account is ready. Start by uploading your first 3D avatar or connecting an on-chain agent identity.</p>
    <a class="btn" href="${APP_URL}/dashboard/">Open Dashboard</a>
    <hr>
    <p class="muted">Questions? Reply to this email and we'll help you out.</p>
  `);
}

function welcomeText(name) {
	return `Welcome to three.ws, ${name}!\n\nYour account is ready. Open your dashboard: ${APP_URL}/dashboard/\n\nQuestions? Reply to this email.`;
}

function verifyHtml(code, mins) {
	return layout(`
    <p class="brand">three.ws</p>
    <h1>Verify your email</h1>
    <p>Enter this code to verify your email address. It expires in ${mins} minutes.</p>
    <div class="code">${esc(code)}</div>
    <p class="muted">If you didn't request this, you can ignore it.</p>
  `);
}

function verifyText(code, mins) {
	return `Your three.ws verification code is: ${code}\n\nExpires in ${mins} minutes.`;
}

function resetHtml(url, mins) {
	return layout(`
    <p class="brand">three.ws</p>
    <h1>Reset your password</h1>
    <p>Click below to set a new password. This link expires in ${mins} minutes.</p>
    <a class="btn" href="${esc(url)}">Reset password</a>
    <p class="muted">If you didn't request a reset, you can safely ignore this email.</p>
  `);
}

function resetText(url, mins) {
	return `Reset your three.ws password:\n${url}\n\nExpires in ${mins} minutes.`;
}

function subscriptionHtml(plan, chain, txId) {
	return layout(`
    <p class="brand">three.ws</p>
    <h1>${capitalize(plan)} plan activated 🎉</h1>
    <p>Your <strong>${capitalize(plan)}</strong> subscription is now active on ${capitalize(chain)}.</p>
    ${txId ? `<p class="muted">Transaction: <code>${esc(txId)}</code></p>` : ''}
    <a class="btn" href="${APP_URL}/dashboard/">Go to Dashboard</a>
  `);
}

function subscriptionText(plan, chain, txId) {
	return `Your three.ws ${plan} plan is now active on ${chain}.\n${txId ? `Transaction: ${txId}\n` : ''}Open dashboard: ${APP_URL}/dashboard/`;
}

function esc(s) {
	return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
