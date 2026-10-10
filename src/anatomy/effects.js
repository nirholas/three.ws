// Anatomy effects: the shader-driven matter that makes a machine read as
// working: flame in a combustor, an exhaust plume with shock diamonds, plasma
// in a reactor, water in a pipe, smoke, steam, sparks, electric arcs, a glow,
// and particles streaming along a flow path.
//
// Every builder returns { object, update(time, dt, frame), setDim(f), dispose() }.
// `frame` carries per-frame viewer state (pixel scale, theme) so the effects
// never reach into the viewer. Volumes are built along +Y from the emitter
// origin and turned onto the spec axis by the effect frame.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const Y = new THREE.Vector3(0, 1, 0);
const AXIS_VEC = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

// Ashima / Stefan Gustavson 3D simplex noise (MIT), plus a 4-octave fbm.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
	const vec2 C=vec2(1.0/6.0,1.0/3.0);
	const vec4 D=vec4(0.0,0.5,1.0,2.0);
	vec3 i=floor(v+dot(v,C.yyy));
	vec3 x0=v-i+dot(i,C.xxx);
	vec3 g=step(x0.yzx,x0.xyz);
	vec3 l=1.0-g;
	vec3 i1=min(g.xyz,l.zxy);
	vec3 i2=max(g.xyz,l.zxy);
	vec3 x1=x0-i1+C.xxx;
	vec3 x2=x0-i2+C.yyy;
	vec3 x3=x0-D.yyy;
	i=mod289(i);
	vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
	float n_=0.142857142857;
	vec3 ns=n_*D.wyz-D.xzx;
	vec4 j=p-49.0*floor(p*ns.z*ns.z);
	vec4 x_=floor(j*ns.z);
	vec4 y_=floor(j-7.0*x_);
	vec4 x=x_*ns.x+ns.yyyy;
	vec4 y=y_*ns.x+ns.yyyy;
	vec4 h=1.0-abs(x)-abs(y);
	vec4 b0=vec4(x.xy,y.xy);
	vec4 b1=vec4(x.zw,y.zw);
	vec4 s0=floor(b0)*2.0+1.0;
	vec4 s1=floor(b1)*2.0+1.0;
	vec4 sh=-step(h,vec4(0.0));
	vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
	vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
	vec3 p0=vec3(a0.xy,h.x);
	vec3 p1=vec3(a0.zw,h.y);
	vec3 p2=vec3(a1.xy,h.z);
	vec3 p3=vec3(a1.zw,h.w);
	vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
	p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
	vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
	m=m*m;
	return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
	float f=0.0;float a=0.5;
	for(int i=0;i<4;i++){f+=a*snoise(p);p*=2.02;a*=0.5;}
	return f*0.5+0.5;
}
`;

const VOLUME_VERT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uWobble;
varying vec2 vUv;
varying vec3 vPos;
varying float vFacing;
${NOISE_GLSL}
void main(){
	vUv = uv;
	vPos = position;
	vec3 p = position;
	if (uWobble > 0.0) {
		float w = snoise(vec3(p.x * 2.0, p.y * 1.5 - uTime * uSpeed * 3.0, p.z * 2.0));
		p.xz *= 1.0 + w * uWobble * uv.y;
	}
	vec4 mv = modelViewMatrix * vec4(p, 1.0);
	vec3 n = normalize(normalMatrix * normal);
	vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
	vFacing = abs(dot(n, v));
	gl_Position = projectionMatrix * mv;
}
`;

// uMode: 0 flame, 1 exhaust, 2 plasma, 3 water stream, 4 water pool.
const VOLUME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
uniform float uDim;
uniform float uMode;
uniform float uScale;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vUv;
varying vec3 vPos;
varying float vFacing;
${NOISE_GLSL}
void main(){
	float t = uTime * uSpeed;
	float ang = vUv.x * 6.2831853;
	vec3 col;
	float alpha;
	if (uMode < 0.5) {
		float n = fbm(vec3(cos(ang) * 1.2, sin(ang) * 1.2, vUv.y * 4.0 - t * 2.6));
		float along = 1.0 - vUv.y;
		float body = pow(vFacing, 1.3);
		float base = smoothstep(0.0, 0.05, vUv.y);
		float tongue = smoothstep(0.15, 0.75, n + along * 0.55);
		alpha = body * base * pow(along, 0.7) * (0.35 + tongue);
		col = mix(uColorB, uColorA, clamp(body * along * 1.1 + n * 0.25, 0.0, 1.0));
	} else if (uMode < 1.5) {
		float n = fbm(vec3(cos(ang), sin(ang), vUv.y * 6.0 - t * 4.0));
		float along = 1.0 - vUv.y;
		float body = pow(vFacing, 1.6);
		float diamonds = pow(0.5 + 0.5 * cos(vUv.y * 34.0), 4.0) * smoothstep(0.0, 0.1, vUv.y) * pow(along, 1.4);
		alpha = body * pow(along, 0.55) * (0.45 + 0.45 * n) + diamonds * body * 0.9;
		col = mix(uColorB, uColorA, clamp(diamonds * 1.4 + body * along * 0.6, 0.0, 1.0));
	} else if (uMode < 2.5) {
		vec3 q = vPos / max(uScale, 0.0001) * 1.6;
		float n = fbm(q + vec3(t * 0.6, -t * 0.45, t * 0.3));
		float n2 = fbm(q * 2.3 - vec3(t * 0.9, t * 0.2, -t * 0.5));
		float rim = pow(1.0 - vFacing, 2.2);
		float filament = smoothstep(0.55, 0.85, n) + smoothstep(0.6, 0.9, n2) * 0.6;
		alpha = 0.18 + rim * 0.85 + filament * 0.7;
		col = mix(uColorB, uColorA, clamp(filament * 0.8 + rim * 0.5, 0.0, 1.0));
	} else if (uMode < 3.5) {
		float n = fbm(vec3(cos(ang) * 2.0, sin(ang) * 2.0, vUv.y * 7.0 - t * 3.2));
		float streak = smoothstep(0.55, 0.82, n);
		float edge = pow(1.0 - vFacing, 1.5);
		alpha = 0.42 + streak * 0.4 + edge * 0.25;
		col = mix(uColorB, uColorA, clamp(streak * 0.9 + edge * 0.4, 0.0, 1.0));
	} else {
		vec3 q = vPos / max(uScale, 0.0001) * 2.5;
		float n = fbm(vec3(q.x - t * 0.5, q.y * 0.5, q.z + t * 0.35));
		float caustic = smoothstep(0.6, 0.78, n);
		alpha = 0.5 + caustic * 0.35;
		col = mix(uColorB, uColorA, caustic);
	}
	alpha = clamp(alpha * uIntensity * uDim, 0.0, 1.0);
	if (alpha < 0.003) discard;
	gl_FragColor = vec4(col, alpha);
}
`;

const POINTS_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
uniform float uPixelScale;
varying float vAlpha;
void main(){
	vAlpha = aAlpha;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	gl_PointSize = max(1.0, aSize * uPixelScale);
	gl_Position = projectionMatrix * mv;
}
`;

const POINTS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uDim;
uniform float uHard;
varying float vAlpha;
void main(){
	float d = length(gl_PointCoord - 0.5);
	float a = uHard > 0.5 ? smoothstep(0.5, 0.2, d) : smoothstep(0.5, 0.0, d);
	a *= vAlpha * uDim;
	if (a < 0.003) discard;
	gl_FragColor = vec4(uColor, a);
}
`;

function blendingFor(frame) {
	return frame?.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
}

function volumeMaterial({ mode, colorA, colorB, intensity, speed, wobble = 0, scale = 1 }) {
	return new THREE.ShaderMaterial({
		vertexShader: VOLUME_VERT,
		fragmentShader: VOLUME_FRAG,
		uniforms: {
			uTime: { value: 0 },
			uSpeed: { value: speed },
			uWobble: { value: wobble },
			uIntensity: { value: intensity },
			uDim: { value: 1 },
			uMode: { value: mode },
			uScale: { value: scale },
			uColorA: { value: new THREE.Color(colorA) },
			uColorB: { value: new THREE.Color(colorB) },
		},
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
}

function pointsMaterial(color, hard = false) {
	return new THREE.ShaderMaterial({
		vertexShader: POINTS_VERT,
		fragmentShader: POINTS_FRAG,
		uniforms: {
			uColor: { value: new THREE.Color(color) },
			uDim: { value: 1 },
			uHard: { value: hard ? 1 : 0 },
			uPixelScale: { value: 100 },
		},
		transparent: true,
		depthWrite: false,
	});
}

/** A group whose +Y points along the effect's axis and direction. */
function effectFrame(eff) {
	const g = new THREE.Group();
	g.position.set(...eff.position);
	const dir = AXIS_VEC[eff.axis].clone().multiplyScalar(eff.direction);
	g.quaternion.setFromUnitVectors(Y, dir);
	return g;
}

function syncBlending(materials, frame, state) {
	const dark = Boolean(frame.dark);
	if (state.dark === dark) return;
	state.dark = dark;
	for (const m of materials) {
		m.blending = blendingFor(frame);
		m.needsUpdate = true;
	}
}

function volumeEffect(eff) {
	const frame = effectFrame(eff);
	const materials = [];
	const geoms = [];
	const add = (geom, mat) => {
		geoms.push(geom);
		materials.push(mat);
		const mesh = new THREE.Mesh(geom, mat);
		mesh.renderOrder = 10;
		frame.add(mesh);
		return mesh;
	};
	const scale = Math.max(eff.radius, eff.length * 0.25);

	if (eff.type === 'flame' || eff.type === 'exhaust') {
		const mode = eff.type === 'flame' ? 0 : 1;
		const outer = new THREE.CylinderGeometry(Math.max(eff.radiusEnd, 0.001), eff.radius, eff.length, 40, 24, true);
		outer.translate(0, eff.length / 2, 0);
		add(outer, volumeMaterial({ mode, colorA: eff.color, colorB: eff.color2, intensity: eff.intensity, speed: eff.speed, wobble: mode === 0 ? 0.14 : 0.04 }));
		const coreLen = eff.length * (mode === 0 ? 0.62 : 0.85);
		const core = new THREE.CylinderGeometry(Math.max(eff.radiusEnd * 0.4, 0.001), eff.radius * 0.55, coreLen, 32, 16, true);
		core.translate(0, coreLen / 2, 0);
		add(core, volumeMaterial({ mode, colorA: '#ffffff', colorB: eff.color, intensity: eff.intensity * 0.9, speed: eff.speed * 1.2, wobble: mode === 0 ? 0.1 : 0.02 }));
	} else if (eff.type === 'plasma') {
		const form = eff.form || 'sphere';
		let geom;
		if (form === 'torus') {
			geom = new THREE.TorusGeometry(eff.radius, Math.max(eff.radiusEnd, eff.radius * 0.08), 32, 128);
			geom.rotateX(Math.PI / 2);
		} else if (form === 'column') {
			geom = new THREE.CylinderGeometry(eff.radiusEnd, eff.radius, eff.length, 40, 16, true);
			geom.translate(0, eff.length / 2, 0);
		} else {
			geom = new THREE.SphereGeometry(eff.radius, 48, 32);
		}
		add(geom, volumeMaterial({ mode: 2, colorA: eff.color, colorB: eff.color2, intensity: eff.intensity, speed: eff.speed, scale }));
	} else if (eff.type === 'water') {
		if (eff.form === 'pool' && eff.size) {
			const geom = new THREE.BoxGeometry(...eff.size);
			add(geom, volumeMaterial({ mode: 4, colorA: eff.color, colorB: eff.color2, intensity: eff.intensity, speed: eff.speed, scale: Math.max(...eff.size) * 0.5 }));
		} else {
			const geom = new THREE.CylinderGeometry(Math.max(eff.radiusEnd, 0.001), eff.radius, eff.length, 32, 12, true);
			geom.translate(0, eff.length / 2, 0);
			add(geom, volumeMaterial({ mode: 3, colorA: eff.color, colorB: eff.color2, intensity: eff.intensity, speed: eff.speed }));
		}
	}

	const state = { dark: null };
	return {
		object: frame,
		update(time, _dt, f) {
			syncBlending(materials, f, state);
			for (const m of materials) m.uniforms.uTime.value = time;
		},
		setDim(d) {
			for (const m of materials) m.uniforms.uDim.value = d;
		},
		dispose() {
			for (const g of geoms) g.dispose();
			for (const m of materials) m.dispose();
		},
	};
}

// Deterministic per-effect randomness so a shared link looks the same twice.
function rng(seed) {
	let s = 0;
	for (const ch of String(seed)) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
	s = s >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return ((s >>> 0) % 1_000_000) / 1_000_000;
	};
}

function particleEffect(eff) {
	const frame = effectFrame(eff);
	const n = eff.count;
	const rand = rng(eff.id);
	const pos = new Float32Array(n * 3);
	const vel = new Float32Array(n * 3);
	const age = new Float32Array(n);
	const life = new Float32Array(n);
	const alpha = new Float32Array(n);
	const size = new Float32Array(n);
	const sparks = eff.type === 'sparks';
	const steam = eff.type === 'steam';
	const baseLife = sparks ? 0.9 : steam ? 1.8 : 2.8;
	const rise = eff.length / baseLife;

	const spawn = (i, initial) => {
		const a = rand() * Math.PI * 2;
		const r = Math.sqrt(rand()) * eff.radius;
		pos[i * 3] = Math.cos(a) * r;
		pos[i * 3 + 1] = 0;
		pos[i * 3 + 2] = Math.sin(a) * r;
		if (sparks) {
			const spread = 0.9;
			vel[i * 3] = (rand() - 0.5) * 2 * spread * rise;
			vel[i * 3 + 1] = (0.6 + rand() * 0.9) * rise * 1.6;
			vel[i * 3 + 2] = (rand() - 0.5) * 2 * spread * rise;
		} else {
			vel[i * 3] = (rand() - 0.5) * 0.25 * rise;
			vel[i * 3 + 1] = (0.75 + rand() * 0.5) * rise;
			vel[i * 3 + 2] = (rand() - 0.5) * 0.25 * rise;
		}
		life[i] = baseLife * (0.7 + rand() * 0.6);
		age[i] = initial ? rand() * life[i] : 0;
	};
	for (let i = 0; i < n; i++) spawn(i, true);

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
	geom.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
	geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
	geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, eff.length / 2, 0), eff.length + eff.radius * 3);
	const mat = pointsMaterial(eff.type === 'smoke' ? eff.color2 : eff.color, sparks);
	const points = new THREE.Points(geom, mat);
	points.renderOrder = 11;
	points.frustumCulled = false;
	frame.add(points);

	const state = { dark: null };
	let dim = 1;
	return {
		object: frame,
		update(_time, dt, f) {
			syncBlending([mat], sparks ? { dark: true } : f, state);
			mat.uniforms.uPixelScale.value = f.pixelScale;
			// Light theme: steam is white on a white page, so it borrows its
			// cooler second color to stay visible.
			if (steam) mat.uniforms.uColor.value.set(f.dark ? eff.color : eff.color2);
			const step = Math.min(dt, 0.05) * eff.speed;
			for (let i = 0; i < n; i++) {
				age[i] += step;
				if (age[i] >= life[i]) spawn(i, false);
				if (sparks) vel[i * 3 + 1] -= 9.8 * 0.35 * rise * step;
				pos[i * 3] += vel[i * 3] * step;
				pos[i * 3 + 1] += vel[i * 3 + 1] * step;
				pos[i * 3 + 2] += vel[i * 3 + 2] * step;
				const k = age[i] / life[i];
				if (sparks) {
					alpha[i] = (1 - k) * eff.intensity;
					size[i] = eff.radius * 0.18;
				} else {
					// Puffs drift outward and grow as they rise.
					pos[i * 3] *= 1 + step * 0.35;
					pos[i * 3 + 2] *= 1 + step * 0.35;
					alpha[i] = Math.sin(Math.PI * k) * (steam ? 0.55 : 0.6) * eff.intensity;
					size[i] = eff.radius * (0.9 + k * 2.6);
				}
			}
			mat.uniforms.uDim.value = dim;
			geom.attributes.position.needsUpdate = true;
			geom.attributes.aAlpha.needsUpdate = true;
			geom.attributes.aSize.needsUpdate = true;
		},
		setDim(d) {
			dim = d;
		},
		dispose() {
			geom.dispose();
			mat.dispose();
		},
	};
}

let glowTexture = null;
function getGlowTexture() {
	if (glowTexture) return glowTexture;
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const ctx = c.getContext('2d');
	const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
	g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
	glowTexture = new THREE.CanvasTexture(c);
	glowTexture.colorSpace = THREE.SRGBColorSpace;
	return glowTexture;
}

function glowEffect(eff) {
	const frame = effectFrame(eff);
	const mat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(eff.color), transparent: true, depthWrite: false });
	const sprite = new THREE.Sprite(mat);
	sprite.renderOrder = 12;
	frame.add(sprite);
	const base = eff.radius * 2.4;
	const state = { dark: null };
	let dim = 1;
	return {
		object: frame,
		update(time, _dt, f) {
			syncBlending([mat], f, state);
			const pulse = 1 + 0.12 * Math.sin(time * eff.speed * Math.PI * 2);
			sprite.scale.setScalar(base * pulse);
			mat.opacity = Math.min(1, 0.85 * eff.intensity) * dim;
			mat.color.set(f.dark ? eff.color : eff.color2);
		},
		setDim(d) {
			dim = d;
		},
		dispose() {
			mat.dispose();
		},
	};
}

function jagged(from, to, rand, depth, roughness) {
	let pts = [from.clone(), to.clone()];
	let amp = from.distanceTo(to) * roughness;
	for (let d = 0; d < depth; d++) {
		const next = [pts[0]];
		for (let i = 0; i < pts.length - 1; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			const mid = a.clone().add(b).multiplyScalar(0.5);
			mid.x += (rand() - 0.5) * amp;
			mid.y += (rand() - 0.5) * amp;
			mid.z += (rand() - 0.5) * amp;
			next.push(mid, b);
		}
		pts = next;
		amp *= 0.55;
	}
	return pts;
}

function electricEffect(eff, ctx) {
	const group = new THREE.Group();
	const from = new THREE.Vector3(...eff.from);
	const to = new THREE.Vector3(...eff.to);
	const rand = rng(eff.id);
	const arcs = [];
	const materials = [];
	for (let k = 0; k < 3; k++) {
		const geom = new LineGeometry();
		geom.setPositions(new Float32Array(jagged(from, to, rand, 5, 0.22).flatMap((p) => [p.x, p.y, p.z])));
		const mat = ctx.lineMaterial({ color: k === 0 ? eff.color : eff.color2, width: k === 0 ? 2.6 : 1.4, transparent: true, opacity: k === 0 ? 1 : 0.7 });
		const line = new Line2(geom, mat);
		line.renderOrder = 12;
		group.add(line);
		arcs.push(line);
		materials.push(mat);
	}
	const glowMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(eff.color2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
	for (const p of [from, to]) {
		const s = new THREE.Sprite(glowMat);
		s.position.copy(p);
		s.scale.setScalar(Math.max(eff.radius, from.distanceTo(to) * 0.12));
		group.add(s);
	}
	let next = 0;
	let dim = 1;
	return {
		object: group,
		update(time) {
			if (time < next) return;
			next = time + (0.05 + rand() * 0.07) / Math.max(eff.speed, 0.1);
			for (const line of arcs) {
				const pts = jagged(from, to, rand, 5, 0.22);
				line.geometry.setPositions(new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])));
			}
			const flicker = 0.65 + rand() * 0.35;
			for (const [i, m] of materials.entries()) m.opacity = (i === 0 ? 1 : 0.7) * flicker * dim * Math.min(1, eff.intensity);
			glowMat.opacity = flicker * dim;
		},
		setDim(d) {
			dim = d;
		},
		dispose() {
			for (const l of arcs) l.geometry.dispose();
			glowMat.dispose();
		},
	};
}

/** Build one spec effect. `ctx.lineMaterial(opts)` makes a resolution-tracked fat-line material. */
export function buildEffect(eff, ctx) {
	switch (eff.type) {
		case 'flame':
		case 'exhaust':
		case 'plasma':
		case 'water':
			return volumeEffect(eff);
		case 'smoke':
		case 'steam':
		case 'sparks':
			return particleEffect(eff);
		case 'electric':
			return electricEffect(eff, ctx);
		case 'glow':
			return glowEffect(eff);
		default:
			return null;
	}
}

/**
 * A flow: particles streaming along a path, over a dashed guide line, with
 * arrowheads showing direction. Fuel, air, current, coolant.
 */
export function buildFlow(flow, ctx) {
	const group = new THREE.Group();
	const curve = new THREE.CatmullRomCurve3(
		flow.path.map((p) => new THREE.Vector3(...p)),
		flow.closed,
		'centripetal',
	);
	const length = curve.getLength();
	const guidePts = curve.getSpacedPoints(Math.min(400, Math.max(32, Math.round(length * 20))));
	const guideGeom = new LineGeometry();
	guideGeom.setPositions(new Float32Array(guidePts.flatMap((p) => [p.x, p.y, p.z])));
	const guideMat = ctx.lineMaterial({ color: flow.color, width: 1.2, dashed: true, dashSize: length / 60, gapSize: length / 90, transparent: true, opacity: 0.55 });
	const guide = new Line2(guideGeom, guideMat);
	guide.computeLineDistances();
	group.add(guide);

	const arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(flow.color), transparent: true, opacity: 0.9 });
	const arrowSize = Math.max(length / 70, 0.04) * flow.size;
	const arrowGeom = new THREE.ConeGeometry(arrowSize * 0.55, arrowSize * 1.6, 12);
	const arrows = [];
	for (const u of flow.closed ? [0.12, 0.45, 0.78] : [0.3, 0.62, 0.94]) {
		const m = new THREE.Mesh(arrowGeom, arrowMat);
		m.position.copy(curve.getPointAt(u));
		m.quaternion.setFromUnitVectors(Y, curve.getTangentAt(u).normalize());
		group.add(m);
		arrows.push(m);
	}

	const n = flow.count;
	const pos = new Float32Array(n * 3);
	const alpha = new Float32Array(n).fill(1);
	const size = new Float32Array(n).fill(arrowSize * 1.1);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
	geom.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
	geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
	const mat = pointsMaterial(flow.color, true);
	const points = new THREE.Points(geom, mat);
	points.frustumCulled = false;
	points.renderOrder = 11;
	group.add(points);

	const tmp = new THREE.Vector3();
	let dim = 1;
	// Speed is in path lengths per second at 1x; flows of very different
	// lengths stay readable because particles keep their spacing.
	return {
		object: group,
		curve,
		update(time, _dt, f) {
			mat.uniforms.uPixelScale.value = f.pixelScale;
			const travel = time * flow.speed;
			for (let i = 0; i < n; i++) {
				let u = (i / n + travel) % 1;
				if (!flow.closed) {
					alpha[i] = Math.min(1, u * 8, (1 - u) * 8);
				}
				curve.getPointAt(u, tmp);
				pos[i * 3] = tmp.x;
				pos[i * 3 + 1] = tmp.y;
				pos[i * 3 + 2] = tmp.z;
			}
			geom.attributes.position.needsUpdate = true;
			if (!flow.closed) geom.attributes.aAlpha.needsUpdate = true;
			mat.uniforms.uDim.value = dim;
		},
		setDim(d) {
			dim = d;
			guideMat.opacity = 0.55 * d;
			arrowMat.opacity = 0.9 * d;
		},
		dispose() {
			guideGeom.dispose();
			arrowGeom.dispose();
			arrowMat.dispose();
			geom.dispose();
			mat.dispose();
		},
	};
}
