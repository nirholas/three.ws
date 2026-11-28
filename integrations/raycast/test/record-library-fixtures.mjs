// Records real production responses for the two search commands into
// test/fixtures/, so the client tests replay real shapes instead of hand-written
// fakes:
//
//   catalog-search.json   two pages of GET /api/catalog plus a no-match query
//   catalog-item.json     GET /api/catalog?id= for one object and one clip
//   my-models.json        GET /api/forge/mine (needs an API key) and its 401
//
//   THREE_WS_API_KEY=sk_live_... node test/record-library-fixtures.mjs [base-url]
//
// The key needs the avatars:read scope, which every default three.ws key holds.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || "https://three.ws").replace(/\/+$/, "");
const apiKey = (process.env.THREE_WS_API_KEY || "").trim();
if (!apiKey) {
  console.error("Set THREE_WS_API_KEY (https://three.ws/dashboard/api-keys) to record the My Models fixture.");
  process.exit(1);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const recorded = new Date().toISOString().slice(0, 10);

async function get(path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers: { accept: "application/json", ...headers } });
  return { path, status: res.status, body: await res.json() };
}

const first = await get("/api/catalog?limit=3&q=wooden+chair");
const second = await get(`/api/catalog?limit=3&q=wooden+chair&offset=${first.body.next_offset}`);
const none = await get("/api/catalog?limit=3&q=zzqxv+flurb");
writeFileSync(join(dir, "catalog-search.json"), JSON.stringify({ recorded, exchanges: [first, second, none] }, null, 1));

const object = await get(`/api/catalog?id=${encodeURIComponent(first.body.items[0].id)}`);
const clipSearch = await get("/api/catalog?limit=1&kind=animation&q=wave");
const clip = await get(`/api/catalog?id=${encodeURIComponent(clipSearch.body.items[0].id)}`);
writeFileSync(join(dir, "catalog-item.json"), JSON.stringify({ recorded, exchanges: [object, clip] }, null, 1));

const mine = await get("/api/forge/mine?limit=2", { authorization: `Bearer ${apiKey}` });
const minePage2 = mine.body.nextBefore
  ? await get(`/api/forge/mine?limit=2&before=${encodeURIComponent(mine.body.nextBefore)}`, {
      authorization: `Bearer ${apiKey}`,
    })
  : null;
const unauthorized = await get("/api/forge/mine?limit=2");
writeFileSync(
  join(dir, "my-models.json"),
  JSON.stringify({ recorded, exchanges: [mine, minePage2, unauthorized].filter(Boolean) }, null, 1),
);
console.log(`wrote catalog-search.json, catalog-item.json, my-models.json (${mine.body.models?.length ?? 0} models on page 1)`);
