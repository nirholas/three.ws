/**
 * Brain Studio — test-harness runtime (P1)
 * ========================================
 * Executes the live brain graph against the REAL multi-provider LLM proxy
 * (/api/brain/chat, SSE), recalls the agent's REAL memory, animates the active
 * path through the graph as it runs, and drives the live avatar via the shared
 * protocol bus. No fake responses, ever.
 *
 * Flow per message (mirrors the compiled circuit):
 *   persona → (memory recall) → model (streamed) → output (avatar speak/emote)
 *
 * Node execution (skill / market) defers to P4-registered runners
 * (brain-nodes.js registerNodeRunner); absent a runner those nodes contribute
 * reasoning instructions to the system prompt (already baked by the compiler) and
 * perform no side effects.
 */

import { apiFetch } from '../../api.js';
import { protocol, ACTION_TYPES } from '../../agent-protocol.js';
import { getNodeRunner } from './brain-nodes.js';

export class BrainRuntime {
	/**
	 * @param {object} o
	 * @param {import('./brain-composer.js').BrainComposer} o.graphView
	 * @param {import('../agent-studio-store.js').default} o.studio
	 * @param {() => object} o.getCompiled   returns compileBrain() of the live graph
	 * @param {() => object} o.getGraph       returns the raw graph (node ids for animation)
	 */
	constructor({ graphView, studio, getCompiled, getGraph }) {
		this.graphView = graphView;
		this.studio = studio;
		this.getCompiled = getCompiled;
		this.getGraph = getGraph;
		this._abort = null;
	}

	abort() {
		this._abort?.abort();
		this._abort = null;
	}

	/**
	 * Run one turn.
	 * @param {string} userText
	 * @param {{ history?: Array<{role,content}>, onToken?:(t:string)=>void, onMeta?:(m)=>void }} opts
	 * @returns {Promise<{ text:string, stats:object }>}
	 */
	async run(userText, { history = [], onToken = () => {}, onMeta = () => {} } = {}) {
		const compiled = this.getCompiled();
		const gv = this.graphView;
		const graph = this.getGraph();
		const nodeOf = (type) => graph.nodes.find((n) => n.type === type);

		// Create the AbortController up-front so P4 runners (step 3) and the stream
		// (step 4) share the same signal and can all be cancelled together.
		this._abort = new AbortController();

		gv.clearActive();
		const circuit = gv.circuit();
		gv.setActive(circuit.nodeIds, circuit.edgeIds);
		const circuitIds = new Set(circuit.nodeIds);

		// 1. Persona lights up first.
		const personaNode = nodeOf('persona');
		if (personaNode) gv.pulseNode(personaNode.id);

		let system = compiled.personaPrompt;

		// 2. Memory recall — real semantic search over the agent's memory.
		const memNode = nodeOf('memory');
		if (memNode && compiled.memory) {
			gv.setNodeBusy(memNode.id, true);
			gv.pulseNode(memNode.id);
			try {
				const recalled = await this._recall(userText, compiled.memory);
				if (recalled.length) {
					system += `\n\nRelevant memories:\n${recalled.map((m) => `- ${m}`).join('\n')}`;
					gv.setNodeStat(memNode.id, `${recalled.length} recalled`);
					this.studio.emitMarket?.({ type: 'memory:recalled', count: recalled.length });
				} else {
					gv.setNodeStat(memNode.id, 'no matches');
				}
			} catch (e) {
				gv.setNodeStat(memNode.id, 'recall failed');
				console.warn('[brain] memory recall failed', e);
			} finally {
				gv.setNodeBusy(memNode.id, false);
			}
		}

		// 3. Skill / market nodes — P4 runners if registered (reasoning-only otherwise).
		// Only nodes wired into the live circuit: orphaned nodes are inert by design
		// (they contribute nothing to the compiled system prompt either).
		for (const node of graph.nodes.filter((n) => circuitIds.has(n.id) && (n.type === 'skill' || n.type === 'market'))) {
			const runner = getNodeRunner(node.type);
			if (!runner) continue;
			gv.setNodeBusy(node.id, true);
			gv.pulseNode(node.id);
			try {
				const out = await runner(node, this._nodeContext(compiled));
				if (out?.context) system += `\n\n${out.context}`;
			} catch (e) {
				console.warn(`[brain] ${node.type} runner failed`, e);
			} finally {
				gv.setNodeBusy(node.id, false);
			}
		}

		// 4. Model — stream real tokens from the multi-provider proxy.
		const modelNode = nodeOf('model');
		if (modelNode) { gv.setNodeBusy(modelNode.id, true); gv.pulseNode(modelNode.id); }
		protocol.emit({ type: ACTION_TYPES.THINK, payload: { thought: 'reasoning…' } });
		this.studio.emitMarket?.({ type: 'brain:thinking' });

		const messages = [...history, { role: 'user', content: userText }].slice(-20);
		let text = '';
		const stats = {};
		try {
			await this._stream({
				provider: compiled.provider,
				system,
				messages,
				maxTokens: compiled.maxTokens,
				onMeta: (m) => { stats.label = m.label; stats.network = m.network; onMeta(m); },
				onFirst: (ms) => {
					stats.firstTokenMs = ms;
					if (modelNode) gv.setNodeStat(modelNode.id, `${ms}ms to first token`);
				},
				onToken: (t) => { text += t; onToken(t); },
				onDone: (d) => {
					stats.elapsedMs = d.elapsedMs;
					stats.firstTokenMs = d.firstTokenMs ?? stats.firstTokenMs;
					stats.usage = d.usage || null;
					if (modelNode) {
						const tok = d.usage?.outputTokens ? `${d.usage.outputTokens} tok` : '';
						const tps = d.usage?.outputTokens && d.elapsedMs ? ` · ${Math.round((d.usage.outputTokens / d.elapsedMs) * 1000)} tok/s` : '';
						gv.setNodeStat(modelNode.id, `${tok}${tps} · ${d.elapsedMs}ms`.trim());
					}
				},
			});
		} finally {
			if (modelNode) gv.setNodeBusy(modelNode.id, false);
		}

		// 5. Output — drive the live avatar.
		const outNode = nodeOf('output');
		if (outNode) {
			gv.pulseNode(outNode.id);
			const o = compiled.output || {};
			if (o.speak !== false && text) {
				protocol.emit({ type: ACTION_TYPES.SPEAK, payload: { text } });
			}
			if (o.emotion !== false) {
				this.studio.emitMarket?.({ type: 'brain:answered' });
			}
		}

		// 6. Memory write — persist the exchange when the node enables it.
		if (memNode && compiled.memory?.write && text) {
			this._remember(userText, text).catch((e) => console.warn('[brain] memory write failed', e));
		}

		return { text, stats };
	}

	// ── Memory (real, via the agent's AgentMemory) ──────────────────────────────

	async _recall(query, cfg) {
		const mem = this.studio.identity?.memory;
		if (!mem?.recall) return [];
		const results = await mem.recall(query, { limit: cfg.topK, minScore: cfg.minScore });
		// AgentMemory returns `content`, the file layer returns `text` (alias of `body`).
		return (results || [])
			.map((m) => (typeof m === 'string' ? m : m.text || m.content || m.body || ''))
			.map((t) => t.trim())
			.filter(Boolean);
	}

	async _remember(userText, replyText) {
		const mem = this.studio.identity?.memory;
		if (!mem?.add) return;
		// AgentMemory.add() reads `content` and runs the real embedding pipeline.
		await mem.add({ type: 'project', content: `User: ${userText}\nAgent: ${replyText}`.slice(0, 1000), tags: ['studio', 'chat'] });
	}

	_nodeContext(compiled) {
		return {
			brain: compiled,
			mint: null, // runtime-supplied by P4; $THREE is the only coin the platform promotes
			recall: (q) => this._recall(q, compiled.memory || { topK: 4, minScore: 0.75 }),
			emit: (action) => protocol.emit(action),
			say: (t) => protocol.emit({ type: ACTION_TYPES.SPEAK, payload: { text: t } }),
			signal: this._abort?.signal,
			now: Date.now(),
		};
	}

	// ── SSE stream from /api/brain/chat ─────────────────────────────────────────

	async _stream({ provider, system, messages, maxTokens, onMeta, onFirst, onToken, onDone }) {
		// _abort was already created in run() before step 3, so P4 runners and this
		// stream share the same signal. Don't recreate it here.
		const resp = await apiFetch('/api/brain/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provider, system, messages, maxTokens }),
			signal: this._abort.signal,
		});
		if (!resp.ok) {
			const detail = await resp.json().catch(() => ({}));
			throw new Error(detail?.error?.message || detail?.message || `chat ${resp.status}`);
		}
		const reader = resp.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let event = null;
		let streamErr = null;

		// SSE frames are separated by a blank line. Each frame may carry an
		// `event:` line plus one or more `data:` lines; a data-only frame is a text
		// chunk (JSON-encoded string), matching the api/brain/chat.js protocol.
		const handleFrame = (frame) => {
			let evName = null;
			const dataLines = [];
			for (const line of frame.split('\n')) {
				if (line.startsWith('event:')) evName = line.slice(6).trim();
				else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
			}
			if (!dataLines.length) return;
			const raw = dataLines.join('\n');
			if (raw === '[DONE]') return;
			let payload;
			try { payload = JSON.parse(raw); } catch { return; }
			switch (evName) {
				case 'meta': onMeta?.(payload); break;
				case 'first': onFirst?.(payload.firstTokenMs); break;
				case 'done': onDone?.(payload); break;
				case 'error': streamErr = new Error(payload.message || 'stream error'); break;
				case 'fallback': break; // advisory
				default: if (typeof payload === 'string') onToken?.(payload); break;
			}
		};

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let sep;
			while ((sep = buf.indexOf('\n\n')) !== -1) {
				const frame = buf.slice(0, sep);
				buf = buf.slice(sep + 2);
				if (frame.trim()) handleFrame(frame);
			}
		}
		if (buf.trim()) handleFrame(buf);
		this._abort = null;
		if (streamErr) throw streamErr;
	}
}
