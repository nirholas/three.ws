import { fetchWithTls } from '/workspaces/carsearch/src/transport/tls.js';
const r = await fetchWithTls('https://www.pcarmarket.com/auction/');
const b = r.body;
console.log('bytes', b.length, 'status', r.status);
// What repeating structures hold the auctions?
for (const re of [/class="([a-z0-9_-]*(?:auction|lot|listing|card|item)[a-z0-9_-]*)"/gi]) {
  const counts = new Map<string, number>();
  for (const m of b.matchAll(re)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  console.log('candidate classes:', [...counts].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([c,n])=>`${c}x${n}`).join('  '));
}
const links = [...b.matchAll(/href="(\/auction\/[^"]+)"/g)].map(m=>m[1]!);
console.log('auction links:', new Set(links).size, [...new Set(links)].slice(0,4));
const prices = [...b.matchAll(/\$[\d,]{4,}/g)].map(m=>m[0]);
console.log('price-shaped strings:', prices.length, prices.slice(0,8));
const titles = [...b.matchAll(/<h\d[^>]*>([^<]{10,90})<\/h\d>/g)].map(m=>m[1]!.trim());
console.log('headings:', titles.length); for (const t of titles.slice(0,6)) console.log('   ', t);
