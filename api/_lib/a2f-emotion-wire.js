// Audio2Face-3D emotion on the wire: what we send and what we read back.
//
// Send: `AudioWithEmotion.emotions` carries EmotionWithTimeCode keyframes
// ({ time_code, emotion: map<string,float> }) for the caller's intended feeling,
// and the stream header's `emotion_post_processing_params` sets how strongly
// that input (the "preferred emotion") and A2F's own audio-inferred
// Audio2Emotion estimate are applied. emotion_strength 0 turns emotion off: the
// model animates a neutral face.
//
// Read: every AnimationData message may carry `metadata.emotion_aggregate`, a
// google.protobuf.Any packing nvidia_ace.emotion_aggregate.v1.EmotionAggregate
// ({ input_emotions, a2e_output, a2f_smoothed_output }, each a list of
// EmotionWithTimeCode). grpc proto-loader hands the Any over as
// { type_url, value: Buffer }; the bytes are decoded here with protobufjs
// against the same vendored descriptor the gRPC client is built from.

import { createRequire } from 'node:module';
import descriptor from './a2f-protos/descriptor.js';
import { A2F_EMOTIONS } from '../../src/voice/a2f-emotion-intent.js';

const AGGREGATE_TYPE = 'nvidia_ace.emotion_aggregate.v1.EmotionAggregate';
const A2F_SET = new Set(A2F_EMOTIONS);

/** Header defaults: NVIDIA's documented emotion_strength default is 0.6. */
export const EMOTION_STRENGTH_DEFAULT = 0.6;
export const PREFERRED_STRENGTH_DEFAULT = 0.6;

let _aggregateType = null;
function aggregateType() {
	if (!_aggregateType) {
		const require = createRequire(import.meta.url);
		const protobuf = require('protobufjs');
		_aggregateType = protobuf.Root.fromJSON(descriptor).lookupType(AGGREGATE_TYPE);
	}
	return _aggregateType;
}

/**
 * Header fields for the emotion request.
 * @param {{ enabled?:boolean, strength?:number, preferredStrength?:number, hasInput?:boolean, beginning?:Record<string,number> }} o
 */
export function emotionHeaderFields({ enabled = true, strength, preferredStrength, hasInput = false, beginning } = {}) {
	if (!enabled) {
		return {
			emotion_post_processing_params: { emotion_strength: 0, enable_preferred_emotion: false, preferred_emotion_strength: 0 },
		};
	}
	const s = clampNum(strength, EMOTION_STRENGTH_DEFAULT);
	const fields = {
		emotion_post_processing_params: {
			emotion_strength: s,
			enable_preferred_emotion: !!hasInput,
			preferred_emotion_strength: hasInput ? clampNum(preferredStrength, PREFERRED_STRENGTH_DEFAULT) : 0,
		},
	};
	// Starting the stream already in the intended emotion avoids a visible ramp
	// up from neutral over the first live_transition_time.
	if (beginning && Object.keys(beginning).length) fields.emotion_params = { beginning_emotion: beginning };
	return fields;
}

/**
 * Normalize caller emotion input to A2F keyframes.
 * Accepts a channel map ({ joy: 0.8 }) or keyframes ([{ t, emotion }]).
 * @returns {Array<{ time_code:number, emotion:Record<string,number> }>}
 */
export function toEmotionKeyframes(input) {
	if (!input) return [];
	const list = Array.isArray(input) ? input : [{ t: 0, emotion: input }];
	const out = [];
	for (const k of list) {
		const emotion = {};
		for (const [name, v] of Object.entries(k?.emotion || {})) {
			const key = String(name).toLowerCase();
			const n = Number(v);
			if (A2F_SET.has(key) && Number.isFinite(n) && n > 0) emotion[key] = Math.min(1, n);
		}
		if (!Object.keys(emotion).length) continue;
		const t = Number(k?.t ?? k?.time_code ?? 0);
		out.push({ time_code: Number.isFinite(t) && t > 0 ? t : 0, emotion });
	}
	out.sort((a, b) => a.time_code - b.time_code);
	return out;
}

/**
 * Decode one AnimationData `metadata.emotion_aggregate` Any.
 * @param {{ type_url?:string, value?:Buffer|Uint8Array }|undefined} any
 * @returns {{ input:Array, a2e:Array, smoothed:Array }|null} each entry { t, emotion }
 */
export function decodeEmotionAggregate(any) {
	if (!any || !any.value || !String(any.type_url || '').endsWith(AGGREGATE_TYPE)) return null;
	const T = aggregateType();
	const msg = T.toObject(T.decode(any.value), { defaults: true, longs: Number });
	const conv = (list) =>
		(Array.isArray(list) ? list : []).map((e) => ({ t: Number(e.time_code) || 0, emotion: e.emotion || {} }));
	return { input: conv(msg.input_emotions), a2e: conv(msg.a2e_output), smoothed: conv(msg.a2f_smoothed_output) };
}

/**
 * Accumulates the emotion A2F reports across a stream into a compact track the
 * browser samples: { names, frames: [{ t, v }], input, a2e, mean, peak, dominant }.
 *   - frames: a2f_smoothed_output, the emotion actually applied, in A2F_EMOTIONS order
 *   - input: what we asked for (echoed back by the service)
 *   - a2e: mean of the service's Audio2Emotion output (its estimate from the
 *     voice, already blended with the preferred emotion when one was sent)
 *   - mean / peak / dominant: summary of the applied track
 */
export class EmotionTrackBuilder {
	constructor() {
		this.byTime = new Map();
		this.input = null;
		this.a2eSum = Object.create(null);
		this.a2eCount = 0;
		this.messages = 0;
	}

	/** Feed one AnimationData message (proto-loader shape). */
	addAnimationData(animationData) {
		const any = animationData?.metadata?.emotion_aggregate;
		const agg = decodeEmotionAggregate(any);
		if (!agg) return;
		this.messages++;
		if (!this.input && agg.input.length) this.input = agg.input[0].emotion;
		for (const e of agg.a2e) {
			for (const [k, v] of Object.entries(e.emotion)) this.a2eSum[k] = (this.a2eSum[k] || 0) + v;
			this.a2eCount++;
		}
		for (const e of agg.smoothed) this.byTime.set(round4(e.t), e.emotion);
	}

	/** @returns {object|null} null when the service reported no emotion at all */
	build() {
		if (!this.byTime.size) return null;
		const names = A2F_EMOTIONS.slice();
		const frames = [...this.byTime.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([t, e]) => ({ t, v: names.map((n) => round4(e[n] || 0)) }));
		const peak = {};
		const mean = {};
		for (let c = 0; c < names.length; c++) {
			let mx = 0;
			let sum = 0;
			for (const f of frames) {
				mx = Math.max(mx, f.v[c]);
				sum += f.v[c];
			}
			peak[names[c]] = round4(mx);
			mean[names[c]] = round4(sum / frames.length);
		}
		const a2e = {};
		if (this.a2eCount) for (const n of names) a2e[n] = round4((this.a2eSum[n] || 0) / this.a2eCount);
		let dominant = null;
		let best = 0.05;
		for (const n of names) {
			if (mean[n] > best) {
				best = mean[n];
				dominant = n;
			}
		}
		return { names, frames, input: roundMap(this.input), a2e: this.a2eCount ? a2e : null, mean, peak, dominant };
	}
}

function clampNum(v, dflt) {
	const n = Number(v);
	if (!Number.isFinite(n)) return dflt;
	return Math.max(0, Math.min(1, n));
}

function roundMap(m) {
	if (!m) return null;
	const out = {};
	for (const [k, v] of Object.entries(m)) if (v > 0) out[k] = round4(v);
	return out;
}

function round4(n) {
	return Math.round(Number(n) * 10000) / 10000;
}
