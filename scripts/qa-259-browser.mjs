import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const B='http://localhost:3201';
const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
const logs=[]; page.on('console', m=>{ if(['error','warning'].includes(m.type())) logs.push(m.type()+': '+m.text()); });
const calls=[]; page.on('response', r=>{ if(r.url().includes('/api/')) calls.push(r.status()+' '+r.url().replace(B,'')); });
const r = await ctx.request.post(B+'/api/auth/login',{data:{email:env.AUDIT_EMAIL,password:env.AUDIT_PASSWORD}}); console.log('login',r.status());
await page.goto(B+'/agent-wallet',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000); await page.screenshot({path:'/tmp/claude-1000/aw1.png'});
console.log(await page.locator('[role=tab]').allInnerTexts());
const tab = page.locator('[role=tab]', {hasText:/custody/i}).first();
console.log('custody tab', await tab.count());
if (await tab.count()) { await tab.click(); await page.waitForTimeout(2500); await page.screenshot({path:'/tmp/claude-1000/aw2.png', fullPage:true}); console.log((await page.locator('#awh-panel-custody').innerText()).slice(0,1500)); }
console.log(calls.filter(c=>/wallet|signer|agents/.test(c)).join('\n')); console.log('CONSOLE', logs.join('\n'));
await b.close();
