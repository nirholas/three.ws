// Seasonal gifts on the classic homepage (/classic). Shows the claim card only
// while it is useful: a live or upcoming drop, or a drop this account already
// claimed. Once a drop closes unclaimed the section stays hidden.
import { mountGiftClaim } from './shared/gift-claim.js';

const section = document.getElementById('home-gifts');
if (section) {
	mountGiftClaim(section, {
		hideWhenClosed: true,
		onState: (drop) => { section.hidden = !drop || (drop.phase === 'ended' && !drop.claim?.claimed); },
	});
}
