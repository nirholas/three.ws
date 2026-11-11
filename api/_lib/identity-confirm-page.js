// The "link <provider> to your existing account?" page an OpenID login shows
// when a provider-verified email matches a three.ws account that verified the
// same address (api/_lib/identities.js decideIdentityLogin, kind 'confirm').
// One template for every provider so the consent wording cannot drift.

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * @param {import('http').ServerResponse} res
 * @param {{ providerLabel: string, action: string, claims: { email: string, display_name?: string|null, avatar_url?: string|null }, next?: string|null }} o
 */
export function renderLinkConfirm(res, { providerLabel, action, claims, next }) {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
	res.setHeader('x-frame-options', 'DENY');
	res.setHeader('x-content-type-options', 'nosniff');
	res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
	const name = claims.display_name || claims.email;
	const p = esc(providerLabel);
	res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link ${p} to your account · three.ws</title><style>:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#0b0b10;color:#eee;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{background:#14141c;border:1px solid #2a2a36;border-radius:16px;padding:28px 28px 24px;max-width:440px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)}h1{font-size:20px;margin:0 0 8px}.sub{color:#aaa;margin:0 0 20px}.who{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:10px 12px;background:#1b1b25;border-radius:10px}.who img,.dot{width:32px;height:32px;border-radius:50%}.dot{background:linear-gradient(135deg,#6a5cff,#ff5ca8);display:grid;place-items:center;color:#fff;font-weight:600}.email{color:#888;font-size:13px}.note{margin:0 0 20px;padding:10px 12px;border-radius:10px;background:#1b1b25;border:1px solid #2a2a36;font-size:13px;color:#bbb}.actions{display:flex;gap:10px}button{flex:1;padding:12px 16px;border-radius:10px;border:0;font-size:15px;font-weight:600;cursor:pointer;transition:filter .15s,transform .15s}button:hover{filter:brightness(1.1)}button:active{transform:scale(.98)}button:focus-visible{outline:2px solid #9a8cff;outline-offset:2px}.allow{background:#6a5cff;color:#fff}.deny{background:transparent;color:#aaa;border:1px solid #2a2a36}.foot{margin-top:16px;font-size:12px;color:#777}</style></head><body><form class="card" method="post" action="${esc(action)}"><h1>Link ${p} to your account?</h1><p class="sub">A three.ws account already uses this email address.</p><div class="who">${claims.avatar_url ? `<img src="${esc(claims.avatar_url)}" alt="" referrerpolicy="no-referrer">` : `<div class="dot">${esc(String(name)[0].toUpperCase())}</div>`}<div><div>${esc(name)}</div><div class="email">${esc(claims.email)}</div></div></div><p class="note">${p} confirmed you own <b>${esc(claims.email)}</b>, and so did three.ws when that account verified its email. Linking lets you sign in to that account with ${p} from now on. Your password and wallets keep working. You can unlink ${p} any time from Settings.</p><input type="hidden" name="next" value="${esc(next || '')}"><div class="actions"><button class="deny" type="submit" name="decision" value="cancel">Not my account</button><button class="allow" type="submit" name="decision" value="link">Link and sign in</button></div><p class="foot">If this is not your account, choose "Not my account" and nothing is changed.</p></form></body></html>`);
}
