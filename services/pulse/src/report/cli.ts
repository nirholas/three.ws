// npm run report [-- --day YYYY-MM-DD] [--no-send] [--print]
import { migrate } from '../db/migrate.ts';
import { db } from '../db/client.ts';
import { publishDailyReport } from './daily.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const dayIdx = args.indexOf('--day');
const day = dayIdx >= 0 ? args[dayIdx + 1]! : new Date().toISOString().slice(0, 10);

await migrate();
const res = await publishDailyReport(day, { send: !flag('no-send') });
if (flag('print')) {
  const [row] = await (await db()).query<{ markdown: string }>(`select markdown from daily_reports where day = $1`, [day]);
  console.log(row?.markdown);
}
console.log(JSON.stringify(res));
await (await db()).close();
process.exit(0);
