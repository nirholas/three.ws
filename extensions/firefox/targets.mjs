// The Firefox Add-ons (AMO) identity of each three.ws extension: the permanent
// gecko id, the data Firefox asks the user to consent to, and the listing
// metadata the first listed submission needs. Shared by extensions/firefox/build.mjs
// (the manifest block) and scripts/submit-firefox-addons.mjs (the AMO listing).

// data_collection_permissions is honored from Firefox 140 on desktop. Declaring
// it with a lower floor makes the linter warn that older versions would install
// the add-on without ever showing the user the consent screen.
export const FIREFOX_MIN_VERSION = '140.0';

// Valid data_collection_permissions categories, from Mozilla's schema
// (https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
export const DATA_CATEGORIES = new Set([
	'authenticationInfo',
	'bookmarksInfo',
	'browsingActivity',
	'financialAndPaymentInfo',
	'healthInfo',
	'locationInfo',
	'personalCommunications',
	'personallyIdentifyingInfo',
	'searchTerms',
	'technicalAndInteraction',
	'websiteActivity',
	'websiteContent',
]);

export const TARGETS = {
	'walk-avatar': {
		// Permanent once listed: AMO ties reviews, users and updates to this id.
		id: 'walk-avatar@three.ws',
		source: 'extensions/walk-avatar',
		// esbuild bundles it, so AMO requires the human-readable source and build
		// steps alongside the package.
		bundled: true,
		// Nothing leaves the browser by default. Narration (off by default) and
		// sign-in each ask at the moment the user turns them on; see
		// extensions/walk-avatar/data-consent.js.
		dataCollection: {
			required: ['none'],
			optional: ['websiteContent', 'authenticationInfo'],
		},
		listing: {
			slug: 'three-ws-walk-avatar',
			categories: ['appearance', 'games-entertainment'],
			summary:
				'Walk your three.ws 3D avatar across any website you choose, and have it read the section you are looking at aloud. It runs only on tabs where you switch it on.',
			homepage: 'https://three.ws/extension',
			privacyUrl: 'https://three.ws/extension/privacy',
		},
	},
	'checkout-companion': {
		id: 'checkout-companion@three.ws',
		source: 'extensions/checkout-companion',
		bundled: false,
		// Its one job is reading a checkout before you pay, so these are the
		// feature itself: the page's redacted visible text, the amounts on it,
		// the site's hostname, and the three.ws credential that authorizes the
		// read. See extensions/checkout-companion/PRIVACY.md.
		dataCollection: {
			required: ['websiteContent', 'financialAndPaymentInfo', 'browsingActivity', 'authenticationInfo'],
		},
		listing: {
			slug: 'three-ws-checkout-companion',
			categories: ['shopping', 'privacy-security'],
			summary:
				'Reads the payment page before you pay: the real total against the price you were shown, whether the charge repeats, and what the fine print commits you to. Never reads a form field.',
			homepage: 'https://three.ws/companion',
			privacyUrl: 'https://github.com/nirholas/three.ws/blob/main/extensions/checkout-companion/PRIVACY.md',
		},
	},
};

export const LISTING_DEFAULTS = {
	license: 'Apache-2.0',
	supportEmail: 'support@three.ws',
	supportUrl: 'https://three.ws/support',
};
