// GET /api/v1/runs/:id/events (api/_lib/agents-v1/run-stream.js): resumable
// server-sent events for a run. The database is replaced by a small fake that
// answers each query the stream makes; the run serializers and the terminal
// status set are the real ones.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { steps: [], runs: [], agentStatus: 'running', stepQueries: [] };
const sqlMock = vi.fn(async (strings, ...values) => {
	const text = strings.join('?');
	if (text.includes('FROM agent_run_steps')) {
		db.stepQueries.push(values[1]);
		return db.steps.filter((s) => s.seq > values[1]);
	}
	if (text.includes('FROM agent_runs')) return [db.runs.length > 1 ? db.runs.shift() : db.runs[0]];
	if (text.includes('FROM agent_identities')) return [{ status: db.agentStatus }];
	return [];
});
vi.mock('../../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));

const getOwnedRunMock = vi.fn();
const stepRunMock = vi.fn();
vi.mock('../../api/_lib/agents-v1/runs.js', async (importOriginal) => ({
	...(await importOriginal()),
	getOwnedRun: (...a) => getOwnedRunMock(...a),
	stepRun: (...a) => stepRunMock(...a),
}));

const { streamRunEvents } = await import('../../api/_lib/agents-v1/run-stream.js');

const RUN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const run = (status) => ({ id: RUN, agent_id: AGENT, goal: 'scan', status, max_steps: 5, step_count: 0 });
const step = (seq, kind = 'tool') => ({ seq, kind, tool_name: 'market.scan', input: {}, output: { ok: true }, created_at: '2026-10-10T00:00:00Z' });

function mkReq(headers = {}) {
	return { headers, on() {} };
}
function mkRes() {
	return {
		chunks: [],
		writableEnded: false,
		writeHead(status, headers) {
			this.status = status;
			this.headers = headers;
		},
		write(c) {
			this.chunks.push(c);
		},
		end() {
			this.writableEnded = true;
		},
	};
}
function events(res) {
	return res.chunks
		.filter((c) => c.startsWith('id:') || c.startsWith('event:'))
		.map((c) => {
			const id = /^id: (\d+)$/m.exec(c)?.[1];
			const event = /^event: (\S+)$/m.exec(c)[1];
			return { id: id ? Number(id) : null, event, data: JSON.parse(/^data: (.*)$/m.exec(c)[1]) };
		});
}
const call = (res, { headers = {}, query = {} } = {}) =>
	streamRunEvents({ req: mkReq(headers), res, params: { id: RUN }, query, principal: { userId: 'user-1' } });

beforeEach(() => {
	Object.assign(db, { steps: [], runs: [], agentStatus: 'running', stepQueries: [] });
	getOwnedRunMock.mockReset().mockResolvedValue(run('completed'));
	stepRunMock.mockReset();
});

describe('streamRunEvents', () => {
	it('refuses a Last-Event-ID that is not a step seq, before opening the stream', async () => {
		const res = mkRes();
		await expect(call(res, { headers: { 'last-event-id': 'abc' } })).rejects.toMatchObject({ status: 400, code: 'invalid_parameter' });
		expect(res.status).toBeUndefined();
	});

	it('refuses a maxSeconds outside its bounds', async () => {
		await expect(call(mkRes(), { query: { maxSeconds: '1' } })).rejects.toMatchObject({ status: 400, code: 'invalid_parameter' });
	});

	it('resumes after Last-Event-ID on a finished run and ends with done, without stepping it', async () => {
		db.steps = [step(1), step(2), step(3, 'final')];
		db.runs = [run('completed')];
		const res = mkRes();
		await call(res, { headers: { 'last-event-id': '1' } });

		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
		expect(db.stepQueries[0]).toBe(1);
		expect(events(res).map((e) => [e.event, e.id])).toEqual([
			['step', 2],
			['step', 3],
			['status', null],
			['done', null],
		]);
		expect(events(res).at(-1).data).toMatchObject({ id: RUN, status: 'completed' });
		expect(stepRunMock).not.toHaveBeenCalled();
		expect(res.writableEnded).toBe(true);
	});

	it('accepts ?after when no header is sent', async () => {
		db.steps = [step(1), step(2)];
		db.runs = [run('failed')];
		const res = mkRes();
		await call(res, { query: { after: '2' } });
		expect(events(res).map((e) => e.event)).toEqual(['status', 'done']);
	});

	it('drives a queued run under its own sse lease and streams the step it produced', async () => {
		db.runs = [run('queued'), run('completed')];
		stepRunMock.mockImplementation(async () => {
			db.steps.push(step(1, 'final'));
			return { stepped: true };
		});
		const res = mkRes();
		await call(res);

		expect(stepRunMock).toHaveBeenCalledTimes(1);
		expect(stepRunMock.mock.calls[0][0]).toBe(RUN);
		expect(stepRunMock.mock.calls[0][1].owner).toMatch(/^sse:[0-9a-f-]{36}$/);
		expect(events(res).map((e) => [e.event, e.data.status ?? e.data.kind])).toEqual([
			['status', 'queued'],
			['step', 'final'],
			['status', 'completed'],
			['done', 'completed'],
		]);
	});

	it('does not drive the run of a stopped agent', async () => {
		db.agentStatus = 'stopped';
		db.runs = [run('running'), run('cancelled')];
		const res = mkRes();
		await call(res, { query: { drive: 'true' } });
		expect(stepRunMock).not.toHaveBeenCalled();
		expect(events(res).at(-1)).toMatchObject({ event: 'done', data: { status: 'cancelled' } });
	});
});
