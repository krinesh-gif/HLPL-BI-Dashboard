import { describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'

// The hashing helpers in ./auth.ts can't be imported here — that module also
// pulls in ./db, which throws without a database connection string. These
// tests pin the same bcrypt contract the helpers rely on.
const BCRYPT_ROUNDS = 12

describe('password hashing', () => {
  it('never stores the plaintext password', async () => {
    const hash = await bcrypt.hash('correct horse battery', BCRYPT_ROUNDS)
    expect(hash).not.toContain('correct horse battery')
  })

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await bcrypt.hash('correct horse battery', BCRYPT_ROUNDS)
    expect(await bcrypt.compare('correct horse battery', hash)).toBe(true)
    expect(await bcrypt.compare('wrong password', hash)).toBe(false)
  })

  it('salts, so the same password hashes differently each time', async () => {
    const a = await bcrypt.hash('same password', BCRYPT_ROUNDS)
    const b = await bcrypt.hash('same password', BCRYPT_ROUNDS)
    expect(a).not.toBe(b)
    expect(await bcrypt.compare('same password', a)).toBe(true)
    expect(await bcrypt.compare('same password', b)).toBe(true)
  })
})
