/**
 * Fluid curl-noise particle system for the homepage hero.
 * Raw WebGL — no dependencies, ~6 KB.
 *
 * Usage:
 *   <canvas id="home-fluid-canvas"></canvas>
 *   <script src="/fluid-particles.js"></script>
 */
(function () {
	'use strict';

	/* ── Vertex shader ──────────────────────────────────────────────────── */
	const VS = `
precision highp float;
attribute vec2  aBase;
attribute float aSeed;
uniform   float uTime;
uniform   vec2  uMouse;
uniform   float uScroll;
uniform   float uDPR;

/* ---- value noise ---- */
float hash(vec2 p){
  return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
}
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

/* ---- 2-D curl of scalar noise field ---- */
vec2 curl(vec2 p){
  const float e=.012;
  return vec2(
    vnoise(p+vec2(0,e))-vnoise(p-vec2(0,e)),
    -(vnoise(p+vec2(e,0))-vnoise(p-vec2(e,0)))
  )/(2.*e);
}

void main(){
  float t  = uTime*.09 + aSeed*6.2832;
  vec2  off= vec2(aSeed*4.7, aSeed*8.1);
  vec2  pos= aBase;

  /* multi-octave curl flow */
  pos += curl(pos*1.1 + t*.035 + off)      * .28;
  pos += curl(pos*2.7 + t*.07  + off*1.6)  * .09;
  pos += curl(pos*6.0 + t*.14  + off*2.9)  * .028;

  /* scroll shifts the field upward */
  pos.y -= uScroll*.4;

  /* mouse repulsion */
  vec2  d   = pos - uMouse;
  float len = length(d);
  float rep = 1.-smoothstep(0.,.3,len);
  pos += normalize(d+.0001)*rep*.2;

  /* torus wrap so particles never leave */
  pos = mod(pos+1.6, 3.2)-1.6;

  gl_Position = vec4(pos,0.,1.);

  float sz = mix(.7,2.6,fract(aSeed*1.618));
  sz *= 1.+rep*2.2;
  gl_PointSize = sz*uDPR;
}`;

	/* ── Fragment shader ────────────────────────────────────────────────── */
	const FS = `
precision mediump float;
uniform vec3 uColor;
void main(){
  vec2  c = gl_PointCoord-.5;
  float d = length(c);
  if(d>.5) discard;
  float a = smoothstep(.5,.05,d)*.55;
  gl_FragColor = vec4(uColor,a);
}`;

	/* ── WebGL helpers ──────────────────────────────────────────────────── */
	function mkShader(gl, type, src) {
		const s = gl.createShader(type);
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return s;
	}

	function mkProg(gl) {
		const p = gl.createProgram();
		gl.attachShader(p, mkShader(gl, gl.VERTEX_SHADER,   VS));
		gl.attachShader(p, mkShader(gl, gl.FRAGMENT_SHADER, FS));
		gl.linkProgram(p);
		return p;
	}

	/* ── FluidParticles class ───────────────────────────────────────────── */
	class FluidParticles {
		constructor(canvas, opts = {}) {
			this.canvas  = canvas;
			this.count   = opts.count  || 6000;
			this.color   = opts.color  || [1.0, 0.85, 0.28];
			this.mouseX  = 0;
			this.mouseY  = 0;
			this.scrollT = 0;
			this.t       = 0;
			this.raf     = null;
			this.running = false;

			const gl = canvas.getContext('webgl');
			if (!gl) return;
			this.gl = gl;
			this._build();
			this._observe();
		}

		_build() {
			const gl   = this.gl;
			const prog = mkProg(gl);
			this.prog  = prog;

			this._uTime   = gl.getUniformLocation(prog, 'uTime');
			this._uMouse  = gl.getUniformLocation(prog, 'uMouse');
			this._uScroll = gl.getUniformLocation(prog, 'uScroll');
			this._uDPR    = gl.getUniformLocation(prog, 'uDPR');
			this._uColor  = gl.getUniformLocation(prog, 'uColor');

			/* random base positions */
			const base  = new Float32Array(this.count * 2);
			const seeds = new Float32Array(this.count);
			for (let i = 0; i < this.count; i++) {
				base[i*2]   = (Math.random()*2-1)*1.5;
				base[i*2+1] = (Math.random()*2-1)*1.5;
				seeds[i]    = Math.random();
			}

			const bBase = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, bBase);
			gl.bufferData(gl.ARRAY_BUFFER, base, gl.STATIC_DRAW);
			this._aBase = gl.getAttribLocation(prog, 'aBase');
			this._bBase = bBase;

			const bSeed = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, bSeed);
			gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
			this._aSeed = gl.getAttribLocation(prog, 'aSeed');
			this._bSeed = bSeed;
		}

		_observe() {
			const io = new IntersectionObserver(([e]) => {
				e.isIntersecting ? this.start() : this.stop();
			}, { threshold: 0.01 });
			io.observe(this.canvas);
		}

		_frame() {
			const { gl, canvas, prog } = this;
			const dpr = Math.min(devicePixelRatio || 1, 2);
			const W   = Math.round(canvas.clientWidth  * dpr);
			const H   = Math.round(canvas.clientHeight * dpr);
			if (canvas.width !== W || canvas.height !== H) {
				canvas.width  = W;
				canvas.height = H;
			}

			gl.viewport(0, 0, W, H);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE); /* additive — glow effect */

			gl.useProgram(prog);
			gl.uniform1f(this._uTime,   this.t);
			gl.uniform2f(this._uMouse,  this.mouseX, this.mouseY);
			gl.uniform1f(this._uScroll, this.scrollT);
			gl.uniform1f(this._uDPR,    dpr);
			gl.uniform3fv(this._uColor, this.color);

			gl.bindBuffer(gl.ARRAY_BUFFER, this._bBase);
			gl.enableVertexAttribArray(this._aBase);
			gl.vertexAttribPointer(this._aBase, 2, gl.FLOAT, false, 0, 0);

			gl.bindBuffer(gl.ARRAY_BUFFER, this._bSeed);
			gl.enableVertexAttribArray(this._aSeed);
			gl.vertexAttribPointer(this._aSeed, 1, gl.FLOAT, false, 0, 0);

			gl.drawArrays(gl.POINTS, 0, this.count);
		}

		start() {
			if (this.running) return;
			this.running = true;
			const tick = (ms) => {
				if (!this.running) return;
				this.t = ms * 0.001;
				this._frame();
				this.raf = requestAnimationFrame(tick);
			};
			this.raf = requestAnimationFrame(tick);
		}

		stop() {
			this.running = false;
			cancelAnimationFrame(this.raf);
		}

		setMouse(nx, ny) { this.mouseX = nx; this.mouseY = ny; }
		setScroll(t)     { this.scrollT = t; }
	}

	/* ── Bootstrap ──────────────────────────────────────────────────────── */
	function init() {
		const canvas = document.getElementById('home-fluid-canvas');
		if (!canvas) return;

		/* particle count: fewer on low-end / mobile */
		const mobile  = innerWidth < 768;
		const lowTier = navigator.hardwareConcurrency <= 4;
		const count   = mobile ? 2500 : lowTier ? 4000 : 6000;

		const fluid = new FluidParticles(canvas, { count });

		/* mouse → NDC */
		window.addEventListener('mousemove', (e) => {
			fluid.setMouse(
				(e.clientX / innerWidth)  *  2 - 1,
				(e.clientY / innerHeight) * -2 + 1,
			);
		}, { passive: true });

		/* scroll progress through hero act */
		const scrollEl = document.querySelector('.home-parallax');
		const heroAct  = document.querySelector('.h-hero-act');
		if (scrollEl && heroAct) {
			scrollEl.addEventListener('scroll', () => {
				fluid.setScroll(
					Math.min(scrollEl.scrollTop / heroAct.offsetHeight, 1),
				);
			}, { passive: true });
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
