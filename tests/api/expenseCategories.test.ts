import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The server's category whitelist and the client's category type are the same
 * list written twice, and they drifted.
 *
 * `fixedExpensesTotal` was added to the model, the allocation engine, the P&L
 * structure and the entry screen — and not to the validator, which went on
 * refusing every figure with a message naming "the nine OPEX lines". Every
 * local check passed: the type-check only sees the client's copy, and the
 * server's is a `Set` of strings it has no reason to compare against anything.
 *
 * So they are compared here.
 */
const CATEGORIES_IN_API = (): string[] => {
  const source = readFileSync('api/cost-versions.ts', 'utf-8')
  const block = /const EXPENSE_CATEGORIES = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? ''
  return [...block.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1])
}

const CATEGORIES_IN_MODEL = (): string[] => {
  const source = readFileSync('src/data/models.ts', 'utf-8')
  const block = /export interface FixedExpenseEntry \{[\s\S]*?category:([\s\S]*?)\n  amount:/.exec(source)?.[1] ?? ''
  return [...block.matchAll(/\|\s*'([a-zA-Z]+)'/g)].map((m) => m[1])
}

describe('fixed-expense categories', () => {
  it('finds both lists', () => {
    expect(CATEGORIES_IN_API().length).toBeGreaterThan(5)
    expect(CATEGORIES_IN_MODEL().length).toBeGreaterThan(5)
  })

  it('are the same on the client and the server', () => {
    const api = [...CATEGORIES_IN_API()].sort()
    const model = [...CATEGORIES_IN_MODEL()].sort()
    const onlyInModel = model.filter((c) => !api.includes(c))
    const onlyInApi = api.filter((c) => !model.includes(c))
    expect(onlyInModel, `the client can send these but the API refuses them: ${onlyInModel.join(', ')}`).toEqual([])
    expect(onlyInApi, `the API accepts these but the client has no such category: ${onlyInApi.join(', ')}`).toEqual([])
  })

  it('includes the single-figure category the entry screen writes', () => {
    expect(CATEGORIES_IN_API()).toContain('fixedExpensesTotal')
  })
})
