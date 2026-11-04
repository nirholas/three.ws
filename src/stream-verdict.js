// The one-line summary under the /stream comparison. It states what was
// measured: the old text always said "Nx faster", so a stream that took longer
// than the classic download printed "0.5x faster".

/**
 * @param {{firstFrameMs:number, bytes:number}} classic
 * @param {{firstFrameMs:number, baseBytes:number}} streamed
 * @param {(n:number)=>string} fmtBytes
 */
export function describeVerdict(classic, streamed, fmtBytes) {
	const ratio = classic.firstFrameMs / streamed.firstFrameMs;
	const bytes = `${fmtBytes(streamed.baseBytes)} versus ${fmtBytes(classic.bytes)} before anything is on screen.`;
	if (!Number.isFinite(ratio) || ratio <= 0) return `First frame timings were not comparable. ${bytes}`;
	if (ratio >= 1.05) return `${ratio.toFixed(1)}x faster to first frame: ${bytes}`;
	if (ratio > 1 / 1.05) return `About the same time to first frame on this run: ${bytes}`;
	return `${(1 / ratio).toFixed(1)}x slower to first frame on this run (server and decode time dominate at this downlink): ${bytes}`;
}
