import { chromium } from 'playwright'
const S = '/tmp/claude-0/-home-user-HLPL-BI-Dashboard/f24a295e-093a-5385-9288-97acefc06862/scratchpad'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 }, timezoneId: 'Asia/Kolkata' })
const p = await ctx.newPage()
const errs = []; p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://127.0.0.1:5202/#/data/upload', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
await p.locator('input[type=file]').first().setInputFiles(`${S}/july.csv`)
await p.waitForTimeout(2500)
const confirm = p.getByRole('button', { name: /import|confirm|upload/i }).last()
if (await confirm.count()) { await confirm.click(); await p.waitForTimeout(2500) }
console.log('errors:', errs.length ? errs.slice(0,3) : 'none')
await b.close()
