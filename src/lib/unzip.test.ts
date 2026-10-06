import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { unzip } from './unzip'

const REAL_ZIP = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/6e71377f-payout_sheet_2026-08-01_To_2026-08-31.zip'

/** A minimal store-method zip, built by hand, so the reader is exercised even
 * where the owner's own archive is not on the machine. */
function storedZip(files: { name: string; body: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const body = enc.encode(f.body)
    const local = new Uint8Array(30 + name.length + body.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, 0, true)
    // Zeroed sizes in the local header, exactly as Blinkit's archive writes
    // them — the whole reason the reader trusts the central directory.
    lv.setUint32(18, 0, true)
    lv.setUint32(22, 0, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(body, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, body.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, dirSize, true)
  ev.setUint32(16, offset, true)

  const total = [...locals, ...centrals, eocd]
  const out = new Uint8Array(total.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of total) { out.set(p, at); at += p.length }
  return out
}

describe('reading a zip', () => {
  it('reads stored entries whose local header declares no size', async () => {
    const entries = await unzip(storedZip([
      { name: 'folder/one.txt', body: 'first' },
      { name: 'folder/two.txt', body: 'second' },
    ]))
    expect(entries.map((e) => e.path)).toEqual(['folder/one.txt', 'folder/two.txt'])
    expect(new TextDecoder().decode(entries[1].bytes)).toBe('second')
  })

  it('leaves folder entries out, since they carry no file', async () => {
    const entries = await unzip(storedZip([{ name: 'folder/', body: '' }, { name: 'folder/a.txt', body: 'a' }]))
    expect(entries.map((e) => e.path)).toEqual(['folder/a.txt'])
  })

  it('refuses something that is not a zip, rather than returning nothing', async () => {
    await expect(unzip(new TextEncoder().encode('this is a spreadsheet, honestly'))).rejects.toThrow(/not a zip/i)
  })
})

// The real archive is the point of the whole reader, so it is read when it is
// there — and skipped, not failed, on a machine that does not have it.
describe.skipIf(!existsSync(REAL_ZIP))('the owner’s own Blinkit archive', () => {
  it('yields the six workbooks of a payout month', async () => {
    const entries = await unzip(readFileSync(REAL_ZIP))
    const names = entries.map((e) => e.path.split('/').pop())
    expect(names).toContain('Payout Breakup.xlsx')
    expect(names).toContain('A&B. Order_level_charges.xlsx')
    expect(names).toContain('C. Inventory_charges.xlsx')
    expect(entries).toHaveLength(6)
    // Every xlsx is itself a zip, so the first bytes are "PK".
    for (const e of entries) expect(Array.from(e.bytes.subarray(0, 2))).toEqual([0x50, 0x4b])
  })
})
