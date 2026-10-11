// The monitor on the desk shows the real desktop: wallpaper, the pinned app
// tiles, the clock and the visitor's name, drawn to a canvas texture that
// refreshes once a second. The same prefs object the shell uses drives it, so
// changing the wallpaper in Settings changes what the monitor shows.

import { CanvasTexture, SRGBColorSpace } from 'three';

const W = 1024;
const H = 640;

/** CSS wallpaper gradients, mirrored for the 2D canvas. Keep in step with desktop.css. */
const WALLS = {
	three: (g, w, h) => {
		g.fillStyle = '#050505';
		g.fillRect(0, 0, w, h);
		const r = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, w * 0.42);
		r.addColorStop(0, 'rgba(196,181,253,0.22)');
		r.addColorStop(1, 'rgba(196,181,253,0)');
		g.fillStyle = r;
		g.fillRect(0, 0, w, h);
		g.strokeStyle = 'rgba(255,255,255,0.05)';
		g.lineWidth = 1;
		for (let x = 0; x < w; x += 56) {
			g.beginPath();
			g.moveTo(x, 0);
			g.lineTo(x, h);
			g.stroke();
		}
		for (let y = 0; y < h; y += 56) {
			g.beginPath();
			g.moveTo(0, y);
			g.lineTo(w, y);
			g.stroke();
		}
	},
	aurora: (g, w, h) => {
		const l = g.createLinearGradient(0, 0, w, h);
		l.addColorStop(0, '#3a2434');
		l.addColorStop(1, '#1a2a4f');
		g.fillStyle = l;
		g.fillRect(0, 0, w, h);
		glow(g, w * 0.22, h * 0.18, w * 0.5, 'rgba(122,63,168,0.65)');
		glow(g, w * 0.82, h * 0.78, w * 0.5, 'rgba(31,111,191,0.65)');
	},
	midnight: (g, w, h) => {
		g.fillStyle = '#05060d';
		g.fillRect(0, 0, w, h);
		glow(g, w * 0.5, 0, w * 0.6, 'rgba(29,43,90,1)');
	},
	solana: (g, w, h) => {
		g.fillStyle = '#0b0616';
		g.fillRect(0, 0, w, h);
		glow(g, w * 0.15, h * 0.85, w * 0.5, 'rgba(20,241,149,0.45)');
		glow(g, w * 0.85, h * 0.15, w * 0.5, 'rgba(153,69,255,0.55)');
	},
	ember: (g, w, h) => {
		g.fillStyle = '#160a0d';
		g.fillRect(0, 0, w, h);
		glow(g, w * 0.8, h, w * 0.55, 'rgba(255,106,44,0.55)');
		glow(g, w * 0.1, h * 0.1, w * 0.45, 'rgba(122,31,74,0.55)');
	},
	graphite: (g, w, h) => {
		const l = g.createLinearGradient(0, 0, w * 0.4, h);
		l.addColorStop(0, '#2a2d33');
		l.addColorStop(1, '#0d0e11');
		g.fillStyle = l;
		g.fillRect(0, 0, w, h);
	},
};

function glow(g, x, y, r, color) {
	const grad = g.createRadialGradient(x, y, 0, x, y, r);
	grad.addColorStop(0, color);
	grad.addColorStop(1, 'rgba(0,0,0,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, W, H);
}

function roundRect(g, x, y, w, h, r) {
	g.beginPath();
	g.moveTo(x + r, y);
	g.arcTo(x + w, y, x + w, y + h, r);
	g.arcTo(x + w, y + h, x, y + h, r);
	g.arcTo(x, y + h, x, y, r);
	g.arcTo(x, y, x + w, y, r);
	g.closePath();
}

/**
 * @param {{ apps: Array<{title:string, hue:number}> }} o
 */
export function createDesktopScreen({ apps }) {
	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const g = canvas.getContext('2d');
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.anisotropy = 8;

	let lastKey = '';
	/**
	 * Redraw if anything changed. Cheap enough to call every frame; it only
	 * paints when the minute, wallpaper, name or prompt differs.
	 */
	function draw({ wall = 'three', name = 'Guest', prompt = '', clock24 = false, accent = '#c4b5fd' } = {}) {
		const d = new Date();
		const time = d.toLocaleTimeString([], { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !clock24 });
		const key = `${wall}|${name}|${prompt}|${time}|${accent}`;
		if (key === lastKey) return false;
		lastKey = key;

		(WALLS[wall] || WALLS.three)(g, W, H);

		// Desktop icons, left column, like the real shell.
		g.textAlign = 'center';
		apps.slice(0, 6).forEach((a, i) => {
			const x = 46;
			const y = 44 + i * 92;
			g.fillStyle = `hsl(${a.hue} 60% 46%)`;
			roundRect(g, x - 24, y - 24, 48, 48, 12);
			g.fill();
			g.fillStyle = 'rgba(255,255,255,0.9)';
			g.font = '600 20px "Space Grotesk", Inter, sans-serif';
			g.fillText(a.title[0], x, y + 7);
			g.fillStyle = '#fff';
			g.font = '500 13px Inter, system-ui, sans-serif';
			g.fillText(a.title, x, y + 44, 84);
		});

		// Centre greeting.
		g.fillStyle = 'rgba(255,255,255,0.55)';
		g.font = '500 16px "JetBrains Mono", monospace';
		g.fillText('THREE.WS OS', W / 2, H * 0.36);
		g.fillStyle = '#fff';
		g.font = '600 64px "Space Grotesk", Inter, sans-serif';
		g.fillText(time, W / 2, H * 0.47);
		g.font = '500 24px Inter, system-ui, sans-serif';
		g.fillStyle = 'rgba(255,255,255,0.78)';
		g.fillText(`Welcome back, ${name}.`, W / 2, H * 0.55);
		if (prompt) {
			g.font = '600 20px Inter, system-ui, sans-serif';
			g.fillStyle = accent;
			g.fillText(prompt, W / 2, H * 0.63);
		}

		// Taskbar.
		g.fillStyle = 'rgba(10,10,14,0.78)';
		g.fillRect(0, H - 56, W, 56);
		g.fillStyle = 'rgba(255,255,255,0.08)';
		g.fillRect(0, H - 56, W, 1);
		const n = Math.min(apps.length, 8);
		const start = W / 2 - (n * 48) / 2;
		for (let i = 0; i < n; i++) {
			g.fillStyle = `hsl(${apps[i].hue} 60% 46%)`;
			roundRect(g, start + i * 48 + 8, H - 44, 32, 32, 9);
			g.fill();
		}
		g.textAlign = 'right';
		g.fillStyle = '#fff';
		g.font = '500 15px Inter, system-ui, sans-serif';
		g.fillText(time, W - 20, H - 24);
		g.textAlign = 'center';

		texture.needsUpdate = true;
		return true;
	}

	return { texture, draw, dispose: () => texture.dispose() };
}
