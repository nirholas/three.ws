import {
	Color,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	MeshLambertMaterial,
	Object3D,
	PlaneGeometry,
	SRGBColorSpace,
	TextureLoader,
	Vector3,
} from 'three';

const CLOUD_TEXTURE =
	'https://rawcdn.githack.com/pmndrs/drei-assets/9225a9f1fbd449d9411125c2f419b843d0308c9b/cloud.png';

// mulberry32 — fast, seeded, deterministic
function seededRand(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Cloud — data container, child of Clouds.
 * @param {object} opts
 * @param {number}   opts.seed        seeded randomisation (default 0)
 * @param {number}   opts.segments    sprite count (default 20)
 * @param {number[]} opts.bounds      [x,y,z] distribution box (default [5,1,1])
 * @param {number}   opts.scale       uniform scale multiplier (default 1)
 * @param {number}   opts.volume      sprite size factor (default 6)
 * @param {number}   opts.speed       rotation speed (default 0)
 * @param {number}   opts.fade        camera-distance fade radius (default 10)
 * @param {number}   opts.opacity     base opacity (default 1)
 * @param {string}   opts.color       tint color (default 'white')
 */
export class Cloud extends Object3D {
	constructor({
		seed = 0,
		segments = 20,
		bounds = [5, 1, 1],
		scale = 1,
		volume = 6,
		speed = 0,
		fade = 10,
		opacity = 1,
		color = 'white',
	} = {}) {
		super();
		this._cfg = {
			seed,
			segments,
			bounds,
			scale,
			volume,
			speed,
			fade,
			opacity,
			color: new Color(color),
		};
		this._segs = [];
		this._build();
	}

	_build() {
		const { seed, segments, bounds, scale, volume, speed } = this._cfg;
		const rand = seededRand(seed);
		const [bx, by, bz] = Array.isArray(bounds) ? bounds : [bounds.x, bounds.y, bounds.z];
		this._segs = Array.from({ length: segments }, () => ({
			pos: new Vector3((rand() - 0.5) * bx, (rand() - 0.5) * by, (rand() - 0.5) * bz),
			rot: rand() * Math.PI * 2,
			size: (0.4 + rand() * 0.6) * volume * scale,
			rotSpeed: (rand() - 0.5) * speed,
		}));
	}
}

/**
 * Clouds — container that renders all child Cloud instances in one draw call.
 *
 * Usage:
 *   const clouds = new Clouds();
 *   clouds.add(new Cloud({ segments: 40, bounds: [10,2,2], volume: 10, color: 'white' }));
 *   scene.add(clouds);
 *   // in animation loop:
 *   clouds.update(camera, delta);
 *
 * @param {object} opts
 * @param {string}  opts.texture   custom texture URL (default: drei cloud asset)
 * @param {number}  opts.limit     max total segments across all clouds (default 200)
 * @param {object}  opts.material  custom THREE.Material override
 */
export class Clouds extends Object3D {
	constructor({ texture, limit = 200, material } = {}) {
		super();
		this._limit = limit;
		this._mat = material || null;
		this._url = texture || CLOUD_TEXTURE;
		this._mesh = null;
		this._elapsed = 0;
		// pre-allocated temps — no per-frame GC
		this._dummy = new Object3D();
		this._tmp = new Vector3();
		this._col = new Color();
		this._inv = new Matrix4();
		this._load();
	}

	_load() {
		new TextureLoader().load(this._url, (tex) => {
			tex.colorSpace = SRGBColorSpace;
			const mat =
				this._mat ||
				new MeshLambertMaterial({
					map: tex,
					transparent: true,
					depthWrite: false,
					side: 2, // DoubleSide
				});
			this._mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, this._limit);
			this._mesh.instanceMatrix.setUsage(DynamicDrawUsage);
			this._mesh.instanceColor = new InstancedBufferAttribute(
				new Float32Array(this._limit * 3),
				3,
			);
			this._mesh.count = 0;
			this._mesh.frustumCulled = false;
			this.add(this._mesh);
		});
	}

	/**
	 * Call once per frame inside your animation loop.
	 * @param {THREE.Camera} camera
	 * @param {number} delta  seconds since last frame
	 */
	update(camera, delta = 0.016) {
		if (!this._mesh) return;
		this._elapsed += delta;

		// World→Clouds-local matrix so instance matrices stay in parent space
		this.updateWorldMatrix(true, false);
		this._inv.copy(this.matrixWorld).invert();

		const camPos = camera.position;
		let idx = 0;

		for (const child of this.children) {
			if (!(child instanceof Cloud)) continue;
			child.updateWorldMatrix(true, false);
			const { fade, opacity, color } = child._cfg;

			for (const seg of child._segs) {
				// segment in world space
				this._tmp.copy(seg.pos).applyMatrix4(child.matrixWorld);

				// billboard: face camera
				this._dummy.position.copy(this._tmp);
				this._dummy.lookAt(camPos);
				this._dummy.rotation.z = seg.rot + this._elapsed * seg.rotSpeed;

				// distance fade — scale to 0 beyond fade radius
				const dist = this._tmp.distanceTo(camPos);
				const vis = fade > 0 ? Math.max(0, 1 - dist / fade) : 1;
				this._dummy.scale.setScalar(seg.size * vis);
				this._dummy.updateMatrix();

				// convert world-space matrix → Clouds-local for instance
				this._dummy.matrix.premultiply(this._inv);
				this._mesh.setMatrixAt(idx, this._dummy.matrix);

				this._col.copy(color).multiplyScalar(opacity);
				this._mesh.setColorAt(idx, this._col);
				idx++;
			}
		}

		this._mesh.count = Math.min(idx, this._limit);
		this._mesh.instanceMatrix.needsUpdate = true;
		if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
	}
}
