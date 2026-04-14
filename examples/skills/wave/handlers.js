// Wave skill — handler implementation.
// Falls back to the body's built-in wave clip if no style-specific clip is shipped.

export async function wave(args, ctx) {
	const { style = 'casual', duration_ms = 1500 } = args;

	// Try to play a style-specific clip shipped with the skill bundle.
	let played = false;
	try {
		const clip = await ctx.loadClip(new URL(`clips/wave-${style}.glb`, ctx.skillBaseURI).href);
		if (clip) {
			await ctx.viewer.play(clip, { blend: 0.2 });
			played = true;
		}
	} catch {
		// No bundled clip — fall through to hint-based lookup.
	}

	if (!played) {
		played = ctx.viewer.playAnimationByHint('wave', { duration_ms });
	}

	ctx.memory.note('waved', { style, played });
	return { ok: played, style };
}
