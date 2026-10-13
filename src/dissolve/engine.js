// The GPU particle engine behind /dissolve.
//
// Every particle lives in a texel of two float textures (position, velocity).
// Each frame two fullscreen passes advance them (velocity, then position), and
// a Points draw reads the result straight from those textures, so a million
// particles never touch the CPU after the shapes are uploaded.
//
// Shapes arrive as ShapeClouds (src/dissolve/shape.js). Each one is Morton
// sorted over the shared stage box so particle i of shape A and particle i of
// shape B sit in the same relative place; a morph then moves feet to feet and
// head to head, with a per-particle stagger that turns the blend into a ripple.

import * as THREE from 'three';
import { mortonOrder, mulberry32 } from './sample-core.js';

export const STAGE_MIN = [-1.6, -1, -1.6];
export const STAGE_MAX = [1.6, 1, 1.6];
const MAX_WAVES = 4;

export const TOOL = { none: 0, gravity: 1, vortex: 2 };

export const DEFAULT_PARAMS = {
	spring: 16,
	damp: 5.2,
	turb: 0.35,
	arc: 0.6,
	stagger: 0.7,
	size: 1,
	bright: 0.55,
	gravity: 0,
};

const FULLSCREEN_VERT = /* glsl */ `
	void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON_GLSL = /* glsl */ `
	float hash11(float n) { return fract(sin(n) * 43758.5453123); }
	// Per-particle morph progress: the stagger makes the blend a ripple instead
	// of one flat cross-fade.
	float progressFor(float mixv, float stagger, float seed) {
		float p = clamp(mixv * (1.0 + stagger) - stagger * seed, 0.0, 1.0);
		return p * p * (3.0 - 2.0 * p);
	}
`;

const VELOCITY_FRAG = /* glsl */ `
	uniform vec2 uRes;
	uniform sampler2D tPos, tVel, tA, tB;
	uniform float uDt, uTime, uMix, uStagger, uSpring, uDamp, uTurb, uGravity, uFloor, uBass, uMid, uArc;
	uniform vec4 uAttr;       // xyz world point, w strength
	uniform float uMode;      // 0 off, 1 gravity well, 2 vortex
	uniform vec3 uAxis;       // camera forward: spin axis for the well, jet axis
	uniform vec4 uWave[${MAX_WAVES}];   // xyz centre, w birth time (negative = unused)
	uniform float uWaveStrength;
	${COMMON_GLSL}

	// Divergence-free flow: the curl of a sum of sine potentials. Particles swirl
	// without bunching up or thinning out, which is what makes it read as fluid.
	vec3 flow(vec3 p, float t) {
		vec3 q = p * 1.35;
		vec3 c1 = vec3(-cos(q.z * 1.0 + t * 1.1), -cos(q.x * 1.0 + t * 0.9), -cos(q.y * 1.0 + t * 1.0));
		vec3 r = p * 2.6 + vec3(1.7, 9.2, 3.1);
		vec3 c2 = vec3(-cos(r.y * 1.0 - t * 0.7), -cos(r.z * 1.0 + t * 1.3), -cos(r.x * 1.0 - t * 0.5));
		return c1 + 0.5 * c2;
	}

	void main() {
		vec2 uv = gl_FragCoord.xy / uRes;
		vec4 pp = texture2D(tPos, uv);
		vec4 vv = texture2D(tVel, uv);
		vec3 pos = pp.xyz;
		vec3 vel = vv.xyz;
		vec4 a = texture2D(tA, uv);
		vec4 b = texture2D(tB, uv);
		float seed = a.w;

		float prog = progressFor(uMix, uStagger, seed);
		vec3 tgt = mix(a.xyz, b.xyz, prog);
		float flight = sin(3.14159265 * prog);
		vec3 travel = b.xyz - a.xyz;
		vec3 side = cross(travel, vec3(0.0, 1.0, 0.0));
		side = side / (length(side) + 1e-4);
		tgt += side * flight * uArc * (seed - 0.5) * 1.4 * length(travel) * 0.5;
		tgt.y += flight * uArc * (hash11(seed * 91.7) - 0.25) * 0.9;
		tgt += tgt * uBass * 0.22;

		vec3 acc = uSpring * (tgt - pos);
		acc += flow(pos, uTime * 0.6) * (uTurb + uMid * 5.0) * 3.0;
		acc -= uDamp * vel;
		acc.y -= uGravity;

		if (uMode > 0.5 && uAttr.w > 0.0) {
			vec3 d = uAttr.xyz - pos;
			if (uMode < 1.5) {
				float r2 = dot(d, d) + 0.02;
				float inv = inversesqrt(r2);
				vec3 dir = d * inv;
				float pull = min(uAttr.w * 3.2 / r2, 140.0);
				acc += dir * pull;
				acc += cross(uAxis, dir) * min(uAttr.w * 5.0 / (r2 + 0.08), 60.0);
				acc -= uSpring * (tgt - pos) * clamp(uAttr.w * 0.8, 0.0, 0.92);
				if (r2 < 0.014) {
					// Past the horizon: thrown out along the spin axis as a relativistic jet.
					float sgn = hash11(pos.x * 13.1 + pos.y * 7.7 + pos.z * 3.3 + uTime) > 0.5 ? 1.0 : -1.0;
					float spd = 5.0 + 7.0 * hash11(pos.z * 17.3 + uTime * 1.7);
					vel = uAxis * sgn * spd + flow(pos * 3.0, uTime) * 0.8;
					gl_FragColor = vec4(vel, 1.0);
					return;
				}
			} else {
				vec3 rel = pos - uAttr.xyz;
				float rr = length(rel.xz);
				float fall = exp(-rr * rr / 1.6);
				acc += vec3(-rel.z, 0.0, rel.x) / (rr + 0.25) * fall * uAttr.w * 34.0;
				acc.y += fall * uAttr.w * 9.0;
				acc -= uSpring * (tgt - pos) * fall * 0.85;
			}
		}

		for (int i = 0; i < ${MAX_WAVES}; i++) {
			vec4 w = uWave[i];
			if (w.w < 0.0) continue;
			float age = uTime - w.w;
			if (age < 0.0 || age > 3.5) continue;
			vec3 dd = pos - w.xyz;
			float r = length(dd) + 1e-4;
			float band = exp(-pow((r - age * 3.4) / 0.3, 2.0));
			float fade = 1.0 - age / 3.5;
			acc += dd / r * band * fade * uWaveStrength * 90.0;
			acc.y += band * fade * uWaveStrength * 14.0;
			acc -= uSpring * (tgt - pos) * band * 0.9;
		}

		vel += acc * uDt;
		if (uGravity > 0.0 && pos.y <= uFloor + 0.002 && vel.y < 0.0) {
			vel.y = -vel.y * 0.46;
			vel.xz *= 0.9;
		}
		float sp = length(vel);
		if (sp > 16.0) vel *= 16.0 / sp;
		float heat = max(vv.w * exp(-uDt * 2.2), min(sp / 7.0, 1.0));
		gl_FragColor = vec4(vel, heat);
	}
`;

const POSITION_FRAG = /* glsl */ `
	uniform vec2 uRes;
	uniform sampler2D tPos, tVel;
	uniform float uDt, uGravity, uFloor;
	void main() {
		vec2 uv = gl_FragCoord.xy / uRes;
		vec4 p = texture2D(tPos, uv);
		vec4 v = texture2D(tVel, uv);
		p.xyz += v.xyz * uDt;
		if (uGravity > 0.0 && p.y < uFloor) p.y = uFloor;
		gl_FragColor = p;
	}
`;

const POINT_VERT = /* glsl */ `
	attribute vec2 ref;
	uniform sampler2D tPos, tVel, tA, cA, cB;
	uniform float uMix, uStagger, uSize, uPx, uBright, uFloor, uMirror;
	varying vec3 vColor;
	varying float vFade;
	${COMMON_GLSL}
	void main() {
		vec4 p = texture2D(tPos, ref);
		vec4 v = texture2D(tVel, ref);
		float seed = texture2D(tA, ref).w;
		float prog = progressFor(uMix, uStagger, seed);
		vec3 col = mix(texture2D(cA, ref).rgb, texture2D(cB, ref).rgb, prog);
		col = pow(max(col, vec3(0.0)), vec3(0.8)) + 0.035;
		float heat = clamp(v.w, 0.0, 1.0);
		col = mix(col, vec3(0.35, 0.8, 1.6), heat * 0.55) * (1.0 + heat * 2.2);
		vec3 world = p.xyz;
		vFade = 1.0;
		if (uMirror > 0.5) {
			world.y = 2.0 * uFloor - world.y;
			vFade = 0.22 * clamp(1.0 - (uFloor - world.y) * 0.45, 0.0, 1.0);
		}
		vColor = col * uBright * 0.16 * vFade;
		vec4 mv = viewMatrix * vec4(world, 1.0);
		gl_Position = projectionMatrix * mv;
		gl_PointSize = max(1.0, uSize * uPx * (0.55 + 0.9 * fract(seed * 7.13)) * (1.0 + heat * 0.8) / -mv.z);
	}
`;

const POINT_FRAG = /* glsl */ `
	varying vec3 vColor;
	varying float vFade;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float a = exp(-dot(c, c) * 20.0);
		if (a < 0.03 || vFade <= 0.0) discard;
		gl_FragColor = vec4(vColor, a);
	}
`;

/** Probe the one capability the engine cannot run without. */
export function probeSupport() {
	const canvas = document.createElement('canvas');
	const gl = canvas.getContext('webgl2');
	if (!gl) return { ok: false, reason: 'webgl2' };
	const float = !!gl.getExtension('EXT_color_buffer_float');
	const half = !!gl.getExtension('EXT_color_buffer_half_float') || float;
	const lose = gl.getExtension('WEBGL_lose_context');
	if (lose) lose.loseContext();
	if (!half) return { ok: false, reason: 'float-targets' };
	return { ok: true, float };
}

export class DissolveEngine {
	/**
	 * @param {THREE.WebGLRenderer} renderer shared with the page's composer
	 * @param {number} side texture side; particle count is side * side
	 */
	constructor(renderer, side) {
		this.renderer = renderer;
		this.side = side;
		this.count = side * side;
		this.time = 0;
		this.params = { ...DEFAULT_PARAMS };
		this.mix = 0;
		this.audio = { bass: 0, mid: 0 };
		this.pointer = { mode: TOOL.none, strength: 0, point: new THREE.Vector3(), axis: new THREE.Vector3(0, 0, -1) };
		this.waves = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, -1));
		this.waveHead = 0;
		this.waveStrength = 1;
		this.springDip = 0;
		this.floorY = -1;

		const useFloat = renderer.extensions.has('EXT_color_buffer_float');
		this.stateType = useFloat ? THREE.FloatType : THREE.HalfFloatType;

		const makeTarget = () =>
			new THREE.WebGLRenderTarget(side, side, {
				type: this.stateType,
				format: THREE.RGBAFormat,
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				depthBuffer: false,
				stencilBuffer: false,
				generateMipmaps: false,
			});
		this.pos = [makeTarget(), makeTarget()];
		this.vel = [makeTarget(), makeTarget()];
		this.flip = 0;

		this.shapes = { A: null, B: null };
		this.textures = {
			posA: this._dataTexture(),
			posB: this._dataTexture(),
			colA: this._dataTexture(),
			colB: this._dataTexture(),
		};

		this._buildSimulation();
		this._buildPoints();
		this._seedState();
	}

	_dataTexture() {
		const t = new THREE.DataTexture(new Float32Array(this.count * 4), this.side, this.side, THREE.RGBAFormat, THREE.FloatType);
		t.minFilter = THREE.NearestFilter;
		t.magFilter = THREE.NearestFilter;
		t.generateMipmaps = false;
		t.needsUpdate = true;
		return t;
	}

	_buildSimulation() {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
		this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.simScene = new THREE.Scene();
		const res = new THREE.Vector2(this.side, this.side);
		const shared = {
			uRes: { value: res },
			uDt: { value: 1 / 60 },
			uGravity: { value: 0 },
			uFloor: { value: this.floorY },
		};
		this.velMaterial = new THREE.ShaderMaterial({
			vertexShader: FULLSCREEN_VERT,
			fragmentShader: VELOCITY_FRAG,
			depthTest: false,
			depthWrite: false,
			uniforms: {
				...shared,
				tPos: { value: null },
				tVel: { value: null },
				tA: { value: this.textures.posA },
				tB: { value: this.textures.posB },
				uTime: { value: 0 },
				uMix: { value: 0 },
				uStagger: { value: this.params.stagger },
				uSpring: { value: this.params.spring },
				uDamp: { value: this.params.damp },
				uTurb: { value: this.params.turb },
				uArc: { value: this.params.arc },
				uBass: { value: 0 },
				uMid: { value: 0 },
				uAttr: { value: new THREE.Vector4() },
				uMode: { value: 0 },
				uAxis: { value: new THREE.Vector3(0, 0, -1) },
				uWave: { value: this.waves },
				uWaveStrength: { value: 1 },
			},
		});
		this.posMaterial = new THREE.ShaderMaterial({
			vertexShader: FULLSCREEN_VERT,
			fragmentShader: POSITION_FRAG,
			depthTest: false,
			depthWrite: false,
			uniforms: { ...shared, tPos: { value: null }, tVel: { value: null } },
		});
		this.simMesh = new THREE.Mesh(geometry, this.velMaterial);
		this.simMesh.frustumCulled = false;
		this.simScene.add(this.simMesh);
	}

	_buildPoints() {
		const refs = new Float32Array(this.count * 2);
		const positions = new Float32Array(this.count * 3);
		for (let y = 0; y < this.side; y++) {
			for (let x = 0; x < this.side; x++) {
				const i = y * this.side + x;
				refs[i * 2] = (x + 0.5) / this.side;
				refs[i * 2 + 1] = (y + 0.5) / this.side;
			}
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('ref', new THREE.BufferAttribute(refs, 2));
		const make = (mirror) =>
			new THREE.ShaderMaterial({
				vertexShader: POINT_VERT,
				fragmentShader: POINT_FRAG,
				transparent: true,
				depthWrite: false,
				depthTest: false,
				blending: THREE.AdditiveBlending,
				uniforms: {
					tPos: { value: null },
					tVel: { value: null },
					tA: { value: this.textures.posA },
					cA: { value: this.textures.colA },
					cB: { value: this.textures.colB },
					uMix: { value: 0 },
					uStagger: { value: this.params.stagger },
					uSize: { value: 0.012 },
					uPx: { value: 1000 },
					uBright: { value: this.params.bright },
					uFloor: { value: this.floorY },
					uMirror: { value: mirror ? 1 : 0 },
				},
			});
		this.pointMaterial = make(false);
		this.mirrorMaterial = make(true);
		this.points = new THREE.Points(geometry, this.pointMaterial);
		this.mirror = new THREE.Points(geometry, this.mirrorMaterial);
		for (const p of [this.points, this.mirror]) p.frustumCulled = false;
		this.group = new THREE.Group();
		this.group.add(this.mirror, this.points);
	}

	/** Born from a loose shell, so the first shape materialises out of a cloud. */
	_seedState() {
		const rng = mulberry32(1337);
		const pos = new Float32Array(this.count * 4);
		for (let i = 0; i < this.count; i++) {
			const u = rng() * 2 - 1;
			const th = rng() * Math.PI * 2;
			const r = 2.2 + rng() * 2.6;
			const s = Math.sqrt(1 - u * u);
			pos[i * 4] = Math.cos(th) * s * r;
			pos[i * 4 + 1] = u * r * 0.7;
			pos[i * 4 + 2] = Math.sin(th) * s * r;
			pos[i * 4 + 3] = 0;
		}
		const seed = new THREE.DataTexture(pos, this.side, this.side, THREE.RGBAFormat, THREE.FloatType);
		seed.minFilter = THREE.NearestFilter;
		seed.magFilter = THREE.NearestFilter;
		seed.needsUpdate = true;
		this._blit(seed, this.pos[0]);
		this._blit(seed, this.pos[1]);
		seed.dispose();
		const zero = new THREE.DataTexture(new Float32Array(this.count * 4), this.side, this.side, THREE.RGBAFormat, THREE.FloatType);
		zero.minFilter = THREE.NearestFilter;
		zero.magFilter = THREE.NearestFilter;
		zero.needsUpdate = true;
		this._blit(zero, this.vel[0]);
		this._blit(zero, this.vel[1]);
		zero.dispose();
	}

	_blit(texture, target) {
		const material = new THREE.ShaderMaterial({
			vertexShader: FULLSCREEN_VERT,
			fragmentShader: /* glsl */ `
				uniform sampler2D tSrc;
				uniform vec2 uRes;
				void main() { gl_FragColor = texture2D(tSrc, gl_FragCoord.xy / uRes); }
			`,
			uniforms: { tSrc: { value: texture }, uRes: { value: new THREE.Vector2(this.side, this.side) } },
			depthTest: false,
			depthWrite: false,
		});
		const previous = this.simMesh.material;
		this.simMesh.material = material;
		this._pass(target);
		this.simMesh.material = previous;
		material.dispose();
	}

	_pass(target) {
		const r = this.renderer;
		const prevTarget = r.getRenderTarget();
		const prevAuto = r.autoClear;
		r.autoClear = false;
		r.setRenderTarget(target);
		r.render(this.simScene, this.simCamera);
		r.setRenderTarget(prevTarget);
		r.autoClear = prevAuto;
	}

	/**
	 * Upload a ShapeCloud into slot 'A' or 'B'. Both slots are Morton sorted over
	 * the same stage box, which is what pairs their particles spatially.
	 */
	setShape(slot, cloud) {
		if (cloud.count !== this.count) throw new RangeError('Cloud size does not match the engine.');
		const order = mortonOrder(cloud.positions, cloud.count, STAGE_MIN, STAGE_MAX);
		const posTex = slot === 'A' ? this.textures.posA : this.textures.posB;
		const colTex = slot === 'A' ? this.textures.colA : this.textures.colB;
		const pos = posTex.image.data;
		const col = colTex.image.data;
		const rng = mulberry32(slot === 'A' ? 9001 : 4242);
		for (let rank = 0; rank < this.count; rank++) {
			const src = order[rank];
			pos[rank * 4] = cloud.positions[src * 3];
			pos[rank * 4 + 1] = cloud.positions[src * 3 + 1];
			pos[rank * 4 + 2] = cloud.positions[src * 3 + 2];
			// The seed rides in A's alpha only; the stagger reads it from there.
			pos[rank * 4 + 3] = slot === 'A' ? rng() : 0;
			col[rank * 4] = cloud.colors[src * 3];
			col[rank * 4 + 1] = cloud.colors[src * 3 + 1];
			col[rank * 4 + 2] = cloud.colors[src * 3 + 2];
			col[rank * 4 + 3] = 1;
		}
		posTex.needsUpdate = true;
		colTex.needsUpdate = true;
		this.shapes[slot] = cloud;
		if (slot === 'A' && !this.shapes.B) this._mirrorIntoB(posTex, colTex);
	}

	/** Until B is chosen, B is a copy of A so the slider never reveals an empty target. */
	_mirrorIntoB() {
		this.textures.posB.image.data.set(this.textures.posA.image.data);
		this.textures.colB.image.data.set(this.textures.colA.image.data);
		this.textures.posB.needsUpdate = true;
		this.textures.colB.needsUpdate = true;
	}

	/** Swap which shape is A and which is B, and flip the blend to match. */
	swap() {
		const { posA, posB, colA, colB } = this.textures;
		const seeds = new Float32Array(this.count);
		const a = posA.image.data;
		const b = posB.image.data;
		for (let i = 0; i < this.count; i++) seeds[i] = a[i * 4 + 3];
		const tmp = new Float32Array(a);
		a.set(b);
		b.set(tmp);
		for (let i = 0; i < this.count; i++) {
			a[i * 4 + 3] = seeds[i];
			b[i * 4 + 3] = 0;
		}
		const tc = new Float32Array(colA.image.data);
		colA.image.data.set(colB.image.data);
		colB.image.data.set(tc);
		for (const t of [posA, posB, colA, colB]) t.needsUpdate = true;
		[this.shapes.A, this.shapes.B] = [this.shapes.B, this.shapes.A];
		this.mix = 1 - this.mix;
	}

	setMix(v) {
		this.mix = Math.min(1, Math.max(0, v));
	}

	setParam(name, value) {
		this.params[name] = value;
	}

	/** Fire a shockwave from a world point. */
	shockwave(point, strength = 1) {
		this.waves[this.waveHead].set(point.x, point.y, point.z, this.time);
		this.waveHead = (this.waveHead + 1) % MAX_WAVES;
		this.waveStrength = strength;
		this.springDip = 0.35;
	}

	/** Advance the simulation by `dt` seconds (clamped for stability). */
	step(dt) {
		const d = Math.min(dt, 1 / 30);
		this.time += d;
		this.springDip = Math.max(0, this.springDip - d);

		const v = this.velMaterial.uniforms;
		const dip = this.springDip > 0 ? 0.25 : 1;
		const collapsed = this.params.gravity > 0;
		v.uDt.value = d;
		v.uTime.value = this.time;
		v.uMix.value = this.mix;
		v.uStagger.value = this.params.stagger;
		v.uSpring.value = collapsed ? 0 : this.params.spring * dip;
		v.uDamp.value = collapsed ? 0.35 : this.params.damp;
		v.uTurb.value = this.params.turb;
		v.uArc.value = this.params.arc;
		v.uGravity.value = this.params.gravity;
		v.uBass.value = this.audio.bass;
		v.uMid.value = this.audio.mid;
		v.uMode.value = this.pointer.mode;
		v.uAttr.value.set(this.pointer.point.x, this.pointer.point.y, this.pointer.point.z, this.pointer.strength);
		v.uAxis.value.copy(this.pointer.axis);
		v.uWaveStrength.value = this.waveStrength;
		const p = this.posMaterial.uniforms;
		p.uDt.value = d;
		p.uGravity.value = this.params.gravity;

		const read = this.flip;
		const write = 1 - this.flip;

		v.tPos.value = this.pos[read].texture;
		v.tVel.value = this.vel[read].texture;
		this.simMesh.material = this.velMaterial;
		this._pass(this.vel[write]);

		p.tPos.value = this.pos[read].texture;
		p.tVel.value = this.vel[write].texture;
		this.simMesh.material = this.posMaterial;
		this._pass(this.pos[write]);

		this.flip = write;
		for (const m of [this.pointMaterial, this.mirrorMaterial]) {
			m.uniforms.tPos.value = this.pos[this.flip].texture;
			m.uniforms.tVel.value = this.vel[this.flip].texture;
			m.uniforms.uMix.value = this.mix;
			m.uniforms.uStagger.value = this.params.stagger;
			m.uniforms.uBright.value = this.params.bright;
		}
	}

	/** Point size in world units, plus the pixel scale for the current viewport. */
	setView(drawingBufferHeight, fovDegrees) {
		const px = drawingBufferHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
		for (const m of [this.pointMaterial, this.mirrorMaterial]) {
			m.uniforms.uPx.value = px;
			m.uniforms.uSize.value = 0.012 * this.params.size * (this.side >= 1024 ? 0.55 : this.side >= 512 ? 0.7 : 1.0);
		}
	}

	dispose() {
		for (const t of [...this.pos, ...this.vel]) t.dispose();
		for (const t of Object.values(this.textures)) t.dispose();
		this.points.geometry.dispose();
		for (const m of [this.velMaterial, this.posMaterial, this.pointMaterial, this.mirrorMaterial]) m.dispose();
		this.simMesh.geometry.dispose();
	}
}
