import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { solanaRpc } from '../src/lib/solana-rpc.ts';

// Real local HTTP endpoints that reproduce what production RPC providers send
// when a plan is exhausted: Helius answers 200 with a plain-text body, Alchemy
// answers a JSON-RPC 429 error object.
function serve(handler: (body: string) => { status: number; body: string }): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const out = handler(body);
        res.writeHead(out.status, { 'content-type': 'text/plain' });
        res.end(out.body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

let exhaustedText: { server: Server; url: string };
let exhaustedJson: { server: Server; url: string };
let healthy: { server: Server; url: string };

beforeAll(async () => {
  exhaustedText = await serve(() => ({ status: 200, body: 'max usage reached' }));
  exhaustedJson = await serve(() => ({ status: 429, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Monthly capacity limit exceeded.' } }) }));
  healthy = await serve((body) => {
    const req = JSON.parse(body);
    return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { method: req.method, value: 'ok' } }) };
  });
});

afterAll(() => {
  for (const s of [exhaustedText, exhaustedJson, healthy]) s.server.close();
});

describe('solanaRpc', () => {
  it('fails over past an endpoint whose quota is exhausted (plain-text body)', async () => {
    const r = await solanaRpc<{ value: string }>([exhaustedText.url, healthy.url], 0, 'getAccountInfo', ['x']);
    expect(r).toEqual({ method: 'getAccountInfo', value: 'ok' });
  });

  it('fails over past a JSON-RPC error response', async () => {
    const r = await solanaRpc<{ value: string }>([exhaustedJson.url, exhaustedText.url, healthy.url], 0, 'getAccountInfo', ['x']);
    expect(r?.value).toBe('ok');
  });

  it('starts at the rotation index and wraps around', async () => {
    const r = await solanaRpc<{ value: string }>([healthy.url, exhaustedText.url], 1, 'getSlot', []);
    expect(r?.value).toBe('ok');
  });

  it('throws naming every endpoint failure when none answer', async () => {
    await expect(solanaRpc([exhaustedText.url, exhaustedJson.url], 0, 'getSlot', [])).rejects.toThrow(/all 2 Solana RPC endpoints failed/);
  });
});
