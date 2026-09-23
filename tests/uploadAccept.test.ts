import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * A reader the file picker will not let you reach is not a feature.
 *
 * Amazon India's settlement reader shipped working, with tests, and was
 * unusable: `.txt` was missing from the input's `accept` list, so the picker
 * greyed every settlement file out. Nothing failed — there was simply no way
 * to select the file. This ties the two together so the next reader cannot
 * ship the same way.
 */
const SOURCE = readFileSync('src/modules/data-management/UploadReportsPage.tsx', 'utf-8')

describe('the upload picker accepts every file the page can read', () => {
  const accept = /accept="([^"]+)"/.exec(SOURCE)?.[1]
  const handled = [...SOURCE.matchAll(/endsWith\('(\.[a-z0-9]+)'\)/g)].map((m) => m[1])

  it('finds both the accept list and the extensions the reader branches on', () => {
    expect(accept, 'no accept attribute found on the file input').toBeDefined()
    expect(handled.length).toBeGreaterThan(3)
  })

  it('offers every extension the reader knows how to open', () => {
    const offered = new Set((accept ?? '').split(',').map((x) => x.trim().toLowerCase()))
    const unreachable = [...new Set(handled)].filter((ext) => !offered.has(ext))
    expect(unreachable, `these readers exist but the picker will not offer them: ${unreachable.join(', ')}`)
      .toEqual([])
  })
})
