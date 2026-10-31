// Seasonal gifts in /play: a small "Gifts" pill that opens the claim card.
//
// Self-attaching like event-countdown.js (no edits to the coin-communities
// bundle). The pill appears only while the drop is live or upcoming, or once
// this account has claimed; a closed drop nobody claimed owes the player nothing.
// A fresh claim lands the wearables in the account grant ledger server-side, so
// the pill nudges the player to open the wardrobe.
import { mountGiftClaim } from '../shared/gift-claim.js';

const STYLE = `
.twx-gift-pill{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:60;
	appearance:none;cursor:pointer;font:600 13px/1 system-ui,sans-serif;padding:10px 14px;border-radius:999px;
	color:#fff;background:rgba(12,12,14,.82);border:1px solid rgba(255,122,26,.7);box-shadow:0 0 14px rgba(255,122,26,.35);
	transition:transform .12s ease,box-shadow .12s ease}
.twx-gift-pill:hover{transform:translateY(-1px);box-shadow:0 0 20px rgba(255,122,26,.55)}
.twx-gift-pill:focus-visible{outline:2px solid #fff;outline-offset:3px}
.twx-gift-pill[data-unclaimed="true"]::after{content:"";display:inline-block;width:8px;height:8px;margin-left:8px;border-radius:50%;background:#ff7a1a}
.twx-gift-dialog{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.6)}
.twx-gift-dialog[hidden]{display:none}
.twx-gift-dialog-box{width:min(560px,100%);max-height:100%;overflow:auto;color:#f5f5f6;background:#0e0e11;border-radius:16px;padding:10px}
.twx-gift-close{display:block;margin:0 0 6px auto}
`;

const style = document.createElement('style');
style.textContent = STYLE;
document.head.appendChild(style);

const pill = document.createElement('button');
pill.type = 'button';
pill.className = 'twx-gift-pill';
pill.textContent = 'Gifts';
pill.hidden = true;
pill.setAttribute('aria-haspopup', 'dialog');

const dialog = document.createElement('div');
dialog.className = 'twx-gift-dialog';
dialog.hidden = true;
dialog.setAttribute('role', 'dialog');
dialog.setAttribute('aria-modal', 'true');
dialog.setAttribute('aria-label', 'Seasonal gifts');
const box = document.createElement('div');
box.className = 'twx-gift-dialog-box';
const close = document.createElement('button');
close.type = 'button';
close.className = 'twx-gift-btn ghost twx-gift-close';
close.textContent = 'Close';
const mount = document.createElement('div');
box.append(close, mount);
dialog.append(box);

function setOpen(open) {
	dialog.hidden = !open;
	if (open) close.focus(); else pill.focus();
}
pill.addEventListener('click', () => setOpen(true));
close.addEventListener('click', () => setOpen(false));
dialog.addEventListener('click', (e) => { if (e.target === dialog) setOpen(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dialog.hidden) setOpen(false); });

function attach() {
	document.body.append(pill, dialog);
	mountGiftClaim(mount, {
		hideWhenClosed: true,
		onState: (drop) => {
			const claimed = !!drop?.claim?.claimed;
			pill.hidden = !drop || (drop.phase === 'ended' && !claimed);
			pill.dataset.unclaimed = String(!claimed && drop?.phase === 'live');
			pill.textContent = claimed ? 'My gifts' : 'Gifts';
		},
	});
}
if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
