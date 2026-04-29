/**
 * Pre-pinned default avatars for ERC-8004 deploy flow.
 *
 * Populated entries here become selectable in the "Default avatar" option of
 * the register-ui Step 3 wizard. Each entry:
 *   - id            stable key (used for radio selection + analytics)
 *   - name          display label
 *   - description   short hint under the card
 *   - url           stable GLB URL (ipfs:// preferred — CID-addressable + free)
 *   - thumbnailUrl  2D poster URL used both as the card preview AND the
 *                   ERC-721 `image` field, skipping client-side re-render
 *
 * Leave the array empty until we've pinned real assets — the wizard gracefully
 * hides the option when `DEFAULT_AVATARS.length === 0`.
 *
 * To add one:
 *   1. Pin the GLB + a 512x512 PNG thumbnail to IPFS (Pinata / R2 / nft.storage).
 *   2. Append an entry below with both `ipfs://<cid>` URLs.
 *   3. Verify the CIDs resolve via https://ipfs.io/ipfs/<cid>.
 *   4. Prettier + `npm run build` — done.
 */

/**
 * @typedef {object} DefaultAvatar
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} url            GLB URL (ipfs:// or https://)
 * @property {string} thumbnailUrl   PNG URL (ipfs:// or https://)
 */

/** @type {DefaultAvatar[]} */
export const DEFAULT_AVATARS = [];

export function getDefaultAvatar(id) {
	return DEFAULT_AVATARS.find((a) => a.id === id) || null;
}
