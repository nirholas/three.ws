/**
 * Mixamo Animation Downloader — Browser Console Script
 *
 * 1. Go to https://www.mixamo.com and sign in
 * 2. Select any character (e.g. "Y Bot")
 * 3. Open DevTools (F12) → Console
 * 4. Paste this entire script and press Enter
 * 5. Wait — it downloads 7 FBX files automatically
 *
 * Then convert them:
 *   python3 scripts/convert-fbx-to-glb.py ~/Downloads/*.fbx
 */

(async function downloadMixamoAnimations() {
	const ANIMATIONS = [
		{ name: 'Idle',    query: 'Breathing Idle' },
		{ name: 'Walking', query: 'Walking' },
		{ name: 'Running', query: 'Running' },
		{ name: 'Waving',  query: 'Waving' },
		{ name: 'Dancing', query: 'Hip Hop Dancing' },
		{ name: 'Sitting', query: 'Sitting' },
		{ name: 'Jumping', query: 'Jump' },
	];

	// Grab auth token from the page
	const token = document.cookie
		.split(';')
		.map(c => c.trim())
		.find(c => c.startsWith('access_token='));

	// Try bearer token from localStorage or existing fetch headers
	let bearer = null;
	if (token) {
		bearer = token.split('=')[1];
	}

	// Fallback: intercept from meta or global state
	if (!bearer) {
		// Mixamo stores auth in window state
		const state = window.__NEXT_DATA__?.props?.pageProps?.accessToken
			|| document.querySelector('meta[name="csrf-token"]')?.content;
		if (state) bearer = state;
	}

	if (!bearer) {
		console.error('❌ Could not find auth token. Make sure you are signed in to Mixamo.');
		console.log('💡 Try: copy a Bearer token from any Network request to mixamo.com and set it manually:');
		console.log('   window.__MIXAMO_TOKEN = "your-token-here"');
		console.log('   Then re-run this script.');
		if (window.__MIXAMO_TOKEN) {
			bearer = window.__MIXAMO_TOKEN;
		} else {
			return;
		}
	}

	const headers = {
		'Accept': 'application/json',
		'Content-Type': 'application/json',
		'Authorization': `Bearer ${bearer}`,
		'X-Api-Key': 'mixamo2',
	};

	// Get the current character ID from the page
	let characterId = null;
	try {
		// Try to extract from URL or page state
		const match = window.location.hash.match(/character=([^&]+)/);
		if (match) characterId = match[1];

		if (!characterId) {
			// Search for Y Bot as fallback
			const searchRes = await fetch('https://www.mixamo.com/api/v1/characters?page=1&limit=1&query=y+bot', { headers });
			const searchData = await searchRes.json();
			characterId = searchData.results?.[0]?.id;
		}
	} catch (e) {
		console.warn('Could not detect character, using default Y Bot');
	}

	// Use Y Bot default if nothing found
	if (!characterId) characterId = '403e7206-d314-416a-9ef2-c618e26a8b6e';

	console.log(`🤖 Character: ${characterId}`);
	console.log(`📦 Downloading ${ANIMATIONS.length} animations...\n`);

	for (const anim of ANIMATIONS) {
		try {
			console.log(`🔍 Searching: "${anim.query}"...`);

			// Search for the animation
			const searchRes = await fetch(
				`https://www.mixamo.com/api/v1/products?page=1&limit=10&query=${encodeURIComponent(anim.query)}&type=Motion`,
				{ headers }
			);

			if (!searchRes.ok) {
				console.error(`   ❌ Search failed (${searchRes.status}). Token may be expired — refresh the page and try again.`);
				return;
			}

			const searchData = await searchRes.json();
			const product = searchData.results?.[0];

			if (!product) {
				console.warn(`   ⚠️ No results for "${anim.query}", skipping`);
				continue;
			}

			console.log(`   Found: "${product.description}" (${product.id})`);

			// Request export
			const exportRes = await fetch('https://www.mixamo.com/api/v1/animations/export', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					character_id: characterId,
					product_id: product.id,
					product_name: product.description,
					preferences: { format: 'fbx7', skin: 'false', fps: '30', reducekf: '0' },
				}),
			});

			if (!exportRes.ok) {
				console.warn(`   ⚠️ Export request failed (${exportRes.status}), skipping`);
				continue;
			}

			// Poll for download URL
			console.log(`   ⏳ Processing...`);
			let downloadUrl = null;
			for (let i = 0; i < 30; i++) {
				await new Promise(r => setTimeout(r, 2000));

				const statusRes = await fetch(
					`https://www.mixamo.com/api/v1/animations/export/${product.id}?character_id=${characterId}`,
					{ headers }
				);
				const statusData = await statusRes.json();

				if (statusData.status === 'completed' && statusData.result?.url) {
					downloadUrl = statusData.result.url;
					break;
				}
				if (statusData.status === 'failed') {
					console.warn(`   ⚠️ Export failed for "${anim.query}"`);
					break;
				}
			}

			if (!downloadUrl) {
				console.warn(`   ⚠️ Timed out waiting for "${anim.query}"`);
				continue;
			}

			// Download the file
			console.log(`   ⬇️ Downloading ${anim.name}.fbx...`);
			const a = document.createElement('a');
			a.href = downloadUrl;
			a.download = `${anim.name}.fbx`;
			document.body.appendChild(a);
			a.click();
			a.remove();

			console.log(`   ✅ ${anim.name}.fbx downloaded!`);

			// Small delay between downloads to be polite
			await new Promise(r => setTimeout(r, 1500));

		} catch (err) {
			console.error(`   ❌ Error with "${anim.query}":`, err.message);
		}
	}

	console.log('\n🎉 Done! Convert with:');
	console.log('   python3 scripts/convert-fbx-to-glb.py ~/Downloads/Idle.fbx ~/Downloads/Walking.fbx ~/Downloads/Running.fbx ~/Downloads/Waving.fbx ~/Downloads/Dancing.fbx ~/Downloads/Sitting.fbx ~/Downloads/Jumping.fbx');
})();
