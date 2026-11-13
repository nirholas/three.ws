import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateDataCommand, isDataCommand, sizeCheck, MAX_RESULT_BYTES, callAgentTool } from '../src/services/hq-bridge-protocol.ts';
import { registerPanelData, readPanelData, hasPanelData, listPanelDataKeys, unregisterPanelData, markPanelDataLoaded, readPanelDataUpdatedAt } from '../src/services/panel-data-registry.ts';

describe('validateDataCommand', () => {
  it('recognises only the three data commands', () => {
    assert.equal(isDataCommand('host:get-panel-data'), true);
    assert.equal(isDataCommand('host:toggle-panel'), false);
  });

  it('accepts a panel-data request and echoes its id', () => {
    const r = validateDataCommand('host:get-panel-data', { id: 'a1', key: 'markets' });
    assert.deepEqual(r, { ok: true, value: { id: 'a1', key: 'markets' } });
  });

  it('rejects a missing or malformed id without echoing it', () => {
    for (const payload of [{}, { id: '' }, { id: 'x'.repeat(65), key: 'markets' }, { id: '<script>', key: 'markets' }, null, 'str', []]) {
      const r = validateDataCommand('host:get-panel-data', payload);
      assert.equal(r.ok, false);
      assert.equal(r.error.id, null);
      assert.equal(r.error.code, 'bad_request');
    }
  });

  it('rejects panel keys that are not simple slugs', () => {
    assert.equal(validateDataCommand('host:get-panel-data', { id: 'a', key: '../x' }).ok, false);
    assert.equal(validateDataCommand('host:get-panel-data', { id: 'a', key: 'Markets' }).ok, false);
  });

  it('run-query takes exactly one of tool or question', () => {
    assert.equal(validateDataCommand('host:run-query', { id: 'q' }).ok, false);
    assert.equal(validateDataCommand('host:run-query', { id: 'q', tool: 'gas', question: 'gas?' }).ok, false);
    assert.deepEqual(validateDataCommand('host:run-query', { id: 'q', tool: 'gas' }).value, { id: 'q', tool: 'gas', args: {} });
    assert.equal(validateDataCommand('host:run-query', { id: 'q', tool: 'Bad Tool' }).ok, false);
    assert.equal(validateDataCommand('host:run-query', { id: 'q', tool: 'gas', args: [1] }).ok, false);
    assert.equal(validateDataCommand('host:run-query', { id: 'q', question: ' '.repeat(3) }).ok, false);
    assert.equal(validateDataCommand('host:run-query', { id: 'q', question: 'x'.repeat(501) }).ok, false);
  });

  it('portfolio-risk validates and trims positions', () => {
    const ok = validateDataCommand('host:get-portfolio-risk', { id: 'p', positions: [{ symbol: ' eth ', usd: 10, protocol: ' aave ', extra: 'dropped' }] });
    assert.deepEqual(ok.value.positions, [{ symbol: 'eth', usd: 10, protocol: 'aave' }]);
    for (const positions of [[], 'x', [{ symbol: 'ETH', usd: 0 }], [{ symbol: 'ETH', usd: Infinity }], [{ usd: 5 }], Array.from({ length: 51 }, () => ({ symbol: 'A', usd: 1 }))]) {
      assert.equal(validateDataCommand('host:get-portfolio-risk', { id: 'p', positions }).ok, false);
    }
  });
});

describe('sizeCheck', () => {
  it('refuses oversized results with a correlated too_large error', () => {
    const r = sizeCheck({ blob: 'x'.repeat(MAX_RESULT_BYTES) }, 'big');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'too_large');
    assert.equal(r.error.id, 'big');
    assert.equal(sizeCheck({ a: 1 }, 'small').ok, true);
  });
});

describe('panel data registry', () => {
  it('returns a detached JSON snapshot and undefined for unknown keys', () => {
    const live = { rows: [1, 2], when: new Date('2026-01-01T00:00:00Z'), fn() {} };
    registerPanelData('unit-test', () => live);
    assert.equal(hasPanelData('unit-test'), true);
    assert.ok(listPanelDataKeys().includes('unit-test'));
    const snap = readPanelData('unit-test');
    assert.deepEqual(snap, { rows: [1, 2], when: '2026-01-01T00:00:00.000Z' });
    snap.rows.push(3);
    assert.deepEqual(live.rows, [1, 2]);
    unregisterPanelData('unit-test');
    assert.equal(readPanelData('unit-test'), undefined);
  });
});

describe('panel data freshness', () => {
  it('reports null until the data has loaded, then the load time as ISO', () => {
    registerPanelData('fresh-test', () => []);
    assert.equal(readPanelDataUpdatedAt('fresh-test'), null);
    markPanelDataLoaded('fresh-test', Date.parse('2026-11-13T10:00:00Z'));
    assert.equal(readPanelDataUpdatedAt('fresh-test'), '2026-11-13T10:00:00.000Z');
    markPanelDataLoaded('fresh-test', Date.parse('2026-11-13T10:05:00Z'));
    assert.equal(readPanelDataUpdatedAt('fresh-test'), '2026-11-13T10:05:00.000Z');
    unregisterPanelData('fresh-test');
    assert.equal(readPanelDataUpdatedAt('fresh-test'), null);
  });

  it('a live provider is always current, and a load mark survives re-registration', () => {
    registerPanelData('live-test', () => ({}), { live: true });
    const before = Date.now();
    const at = Date.parse(readPanelDataUpdatedAt('live-test'));
    assert.ok(at >= before && at <= Date.now() + 1);
    unregisterPanelData('live-test');

    markPanelDataLoaded('early-test', Date.parse('2026-11-13T09:00:00Z'));
    registerPanelData('early-test', () => 1);
    assert.equal(readPanelDataUpdatedAt('early-test'), '2026-11-13T09:00:00.000Z');
    unregisterPanelData('early-test');
  });

  it('ignores an invalid load time instead of storing NaN', () => {
    registerPanelData('nan-test', () => 1);
    markPanelDataLoaded('nan-test', Number.NaN);
    assert.equal(readPanelDataUpdatedAt('nan-test'), null);
    unregisterPanelData('nan-test');
  });
});

/**
 * Observed 2026-11-13 in the host-bridge e2e on a loaded machine: the agent
 * tool answered 200 in 65 ms, the HQ frame's main thread stalled, the 20 s
 * abort signal fired while the body was still being read, and the bridge
 * posted hq:query-result with an empty object instead of an error.
 */
describe('callAgentTool', () => {
  const okHeaders = { status: 200, headers: { 'Content-Type': 'application/json' } };

  it('returns the parsed result of a successful call', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ tool: 'gas', rows: [], facts: [] }), okHeaders);
    assert.deepEqual(await callAgentTool({ tool: 'gas' }, { fetchImpl }), { tool: 'gas', rows: [], facts: [] });
  });

  it('rejects with a TimeoutError when the body read outlives the timeout, instead of resolving {}', async () => {
    const fetchImpl = async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"tool":"top_yields","rows":['));
          init.signal.addEventListener('abort', () => controller.error(init.signal.reason));
        },
      });
      return new Response(body, okHeaders);
    };
    await assert.rejects(callAgentTool({ tool: 'top_yields' }, { fetchImpl, timeoutMs: 30 }), (err) => err.name === 'TimeoutError');
  });

  it('rejects a 200 whose body is not a JSON object', async () => {
    const html = async () => new Response('<!doctype html><p>proxy page</p>', okHeaders);
    await assert.rejects(callAgentTool({ tool: 'gas' }, { fetchImpl: html }), /agent-tools/);
    const scalar = async () => new Response('null', okHeaders);
    await assert.rejects(callAgentTool({ tool: 'gas' }, { fetchImpl: scalar }), /agent-tools/);
  });

  it('surfaces the server error message on a non-2xx reply', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: 'Unknown tool "x"' }), { status: 400 });
    await assert.rejects(callAgentTool({ tool: 'x' }, { fetchImpl }), /Unknown tool "x"/);
    const bare = async () => new Response('oops', { status: 502 });
    await assert.rejects(callAgentTool({ tool: 'x' }, { fetchImpl: bare }), /agent-tools HTTP 502/);
  });
});
