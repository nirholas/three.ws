// WebGL context loss, handled the way a production viewer has to.
//
// Browsers drop a WebGL context when the GPU driver resets, the GPU process
// crashes, or a page opens more contexts than the browser allows (Chrome keeps
// 16). Without a handler the canvas freezes or goes black for good. Calling
// preventDefault() on `webglcontextlost` is what tells the browser the page can
// restore; three.js then re-initialises its GL state on `webglcontextrestored`
// and re-uploads geometry and textures lazily. Anything rendered INTO a GPU
// target (PMREM environments, baked render targets) is gone and must be rebuilt
// by the caller in `onRestored`.

const NOTICE_TEXT = 'The graphics driver reset. The 3D view will come back on its own in a moment.';

function createNotice(canvas) {
	const host = canvas.parentElement;
	if (!host) return null;
	const el = document.createElement('div');
	el.setAttribute('role', 'status');
	el.textContent = NOTICE_TEXT;
	Object.assign(el.style, {
		position: 'absolute',
		left: '50%',
		top: '50%',
		transform: 'translate(-50%, -50%)',
		maxWidth: '22rem',
		padding: '0.75rem 1rem',
		borderRadius: '10px',
		background: 'rgba(12, 12, 14, 0.86)',
		color: '#f2f2f2',
		font: '500 13px/1.45 system-ui, sans-serif',
		textAlign: 'center',
		zIndex: '5',
		pointerEvents: 'none',
	});
	if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
	host.appendChild(el);
	return el;
}

/**
 * Keep a canvas recoverable across WebGL context loss.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {() => void} [opts.onLost] stop drawing here
 * @param {() => void} [opts.onRestored] rebuild GPU-rendered resources, then resume
 * @param {boolean} [opts.notice=true] show a status overlay while the context is lost
 * @returns {{ readonly lost: boolean, detach: () => void }}
 */
export function handleContextLoss(canvas, opts = {}) {
	const { onLost, onRestored, notice = true } = opts;
	let lost = false;
	let noticeEl = null;

	const hide = () => {
		noticeEl?.remove();
		noticeEl = null;
	};
	const lostHandler = (e) => {
		e.preventDefault();
		lost = true;
		if (notice && !noticeEl) noticeEl = createNotice(canvas);
		onLost?.();
	};
	const restoredHandler = () => {
		lost = false;
		hide();
		onRestored?.();
	};

	canvas.addEventListener('webglcontextlost', lostHandler);
	canvas.addEventListener('webglcontextrestored', restoredHandler);

	return {
		get lost() {
			return lost;
		},
		detach() {
			hide();
			canvas.removeEventListener('webglcontextlost', lostHandler);
			canvas.removeEventListener('webglcontextrestored', restoredHandler);
		},
	};
}
