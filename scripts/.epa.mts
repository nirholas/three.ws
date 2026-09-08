/**
 * EPA fuel economy: a free, keyless, documented API.
 *
 * It fills mpgCity and mpgHighway for every car whose year, make and model we
 * know, which is nearly all of them. That is a facet with almost no coverage
 * today filled from a public dataset, with no crawling and no blocking risk.
 */
const base = 'https://www.fueleconomy.gov/ws/rest/vehicle/menu';
for (const [label, url] of [
  ['years', `${base}/year`],
  ['makes 2017', `${base}/make?year=2017`],
  ['models', `${base}/model?year=2017&make=Porsche`],
  ['options', `${base}/options?year=2017&make=Porsche&model=Macan`],
] as [string, string][]) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log(`${label.padEnd(12)} ${r.status}  ${t.slice(0, 200).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`${label.padEnd(12)} ERR ${(e as Error).message.slice(0, 60)}`); }
}
// And the record itself, which carries the mpg figures.
const r = await fetch('https://www.fueleconomy.gov/ws/rest/vehicle/41007', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
const j = await r.json() as Record<string, unknown>;
console.log('\nvehicle record fields:', Object.keys(j).filter(k => /city|highway|comb|fuel|cyl|disp|trany|drive|year|make|model|range|batt/i.test(k)).join(' '));
console.log('sample:', JSON.stringify({ year: j.year, make: j.make, model: j.model, city08: j.city08, highway08: j.highway08, cylinders: j.cylinders, displ: j.displ, trany: j.trany, drive: j.drive }));
