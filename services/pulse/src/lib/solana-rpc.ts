// Solana JSON-RPC over HTTP with endpoint failover. Paid providers answer an
// exhausted plan in provider-specific ways (Helius: 200 with a plain-text
// "max usage reached"; Alchemy: a JSON-RPC 429 error), so any non-JSON body,
// HTTP error or JSON-RPC error moves on to the next endpoint instead of
// failing the call. `start` is the caller's rotation index, so load spreads
// across healthy endpoints.
const TIMEOUT_MS = 10_000;

export async function solanaRpc<T = unknown>(urls: string[], start: number, method: string, params: unknown[]): Promise<T> {
  if (urls.length === 0) throw new Error('no Solana RPC endpoints configured');
  const failures: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[(start + i) % urls.length]!;
    const host = new URL(url).host;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        failures.push(`${host}: HTTP ${res.status} ${text.slice(0, 60)}`);
        continue;
      }
      if (j?.error) {
        failures.push(`${host}: ${j.error.code ?? ''} ${String(j.error.message ?? '').slice(0, 60)}`);
        continue;
      }
      if (!res.ok || !('result' in (j ?? {}))) {
        failures.push(`${host}: HTTP ${res.status}`);
        continue;
      }
      return j.result as T;
    } catch (err) {
      failures.push(`${host}: ${(err as Error).message}`);
    }
  }
  throw new Error(`all ${urls.length} Solana RPC endpoints failed (${failures.join('; ')})`);
}
