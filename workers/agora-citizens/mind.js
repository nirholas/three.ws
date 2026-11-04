// The slow-path mind of every citizen: observe -> reflect -> plan.
//
// The world loop (engine.js) is never touched by this module's latency. Each
// projected activity is observed synchronously and cheaply (an in-memory push),
// and a separate timer (see index.js) asks the model to reflect and plan for the
// citizens whose accumulated importance crossed the threshold. The model call is
// injected, so tests drive it with recorded text and the worker passes the
// platform's llmComplete.

import { MemoryStream } from './memory-stream.js';
import { reflect } from './reflect.js';
import { makePlan } from './plan.js';

export const MAX_STORED_REFLECTIONS = 5;
// A citizen reflects at most this often, however fast events arrive.
export const MIN_REFLECT_GAP_MS = 10 * 60 * 1000;

export class MindKeeper {
	/**
	 * @param {{store: {saveMind: Function}, llm: Function, log?: object, minGapMs?: number}} deps
	 */
	constructor({ store, llm, log, minGapMs = MIN_REFLECT_GAP_MS }) {
		this.store = store;
		this.llm = llm;
		this.log = log;
		this.minGapMs = minGapMs;
		/** @type {Map<string, {name:string, profession:string, stream:MemoryStream, mind:{reflections:{text:string,at:number}[], plan:{steps:string[],at:number}|null, observed:number}, lastReflectAt:number, busy:boolean}>} */
		this.citizens = new Map();
	}

	register({ id, name, profession }) {
		if (this.citizens.has(id)) return;
		this.citizens.set(id, {
			name,
			profession,
			stream: new MemoryStream(),
			mind: { reflections: [], plan: null, observed: 0 },
			lastReflectAt: 0,
			busy: false,
		});
	}

	/** Feed one projected activity into its citizen's stream. Never throws. */
	observe(activity, now = Date.now()) {
		const c = this.citizens.get(activity.citizenId);
		if (!c) return;
		const m = c.stream.observe(activity, now);
		if (m) c.mind.observed++;
	}

	/** Wrap a store so every appendActivity is also observed. Returns the wrapper. */
	wrapStore(store) {
		const keeper = this;
		return new Proxy(store, {
			get(target, prop, receiver) {
				if (prop !== 'appendActivity') return Reflect.get(target, prop, receiver);
				return async (a) => {
					const id = await target.appendActivity(a);
					// A duplicate (null id) was already observed when first written.
					if (id != null) keeper.observe(a);
					return id;
				};
			},
		});
	}

	/**
	 * Reflect and plan for every citizen that is due. Sequential, so the model
	 * sees at most one request at a time from this worker. Returns how many
	 * citizens produced a new reflection.
	 */
	async tick(now = Date.now()) {
		let reflected = 0;
		for (const [id, c] of this.citizens) {
			if (c.busy || !c.stream.shouldReflect() || now - c.lastReflectAt < this.minGapMs) continue;
			c.busy = true;
			try {
				const r = await reflect({ name: c.name, profession: c.profession, stream: c.stream, llm: this.llm, now });
				c.lastReflectAt = now;
				if (!r) continue;
				c.mind.reflections = [...c.mind.reflections, { text: r.text, at: r.at }].slice(-MAX_STORED_REFLECTIONS);
				const plan = await makePlan({ name: c.name, profession: c.profession, stream: c.stream, reflection: r.text, llm: this.llm, now });
				if (plan) c.mind.plan = plan;
				await this.store.saveMind(id, c.mind);
				reflected++;
			} catch (err) {
				c.lastReflectAt = now;
				this.log?.warn?.('mind tick failed', { name: c.name, err: err?.message });
			} finally {
				c.busy = false;
			}
		}
		return reflected;
	}
}
