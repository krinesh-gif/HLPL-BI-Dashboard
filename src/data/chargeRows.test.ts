import { describe, expect, it } from 'vitest'
import { chargeKind, isChargeSku, SMYTTEN_CHARGE_SKU } from './chargeRows'

/** The three charge lines the owner's own Smytten files actually contain. */
const REAL = [
  '5097936; DTO(11675180278861);Replacement - ; Product Is Damaged',
  'Logistics;Order No.5333251;  DTO(11675189323970);Replacement 0 ; Wrong Product Received',
  'Logistics;Order No.5394741; DTO(11675191307884);Replacement 11675191392061 ; Product Is Damaged',
]

describe('telling a charge from a product', () => {
  it('knows the code its reader mints', () => {
    expect(isChargeSku(SMYTTEN_CHARGE_SKU)).toBe(true)
    expect(isChargeSku(' SMYTTEN/CHARGE ')).toBe(true)
  })

  it('does not claim a product that merely sounds like one', () => {
    expect(isChargeSku('ARV0078AB4')).toBe(false)
    expect(isChargeSku('AO/LBalm/NonTinted')).toBe(false)
    // A real product code could say 'charge' — a hair-growth charge pack — and
    // a substring test would have swallowed it.
    expect(isChargeSku('AO/Recharge/Serum')).toBe(false)
  })
})

describe('what kind of charge it is', () => {
  it('reads every one of the real lines as the reverse leg of a replacement', () => {
    for (const description of REAL) expect(chargeKind(description)).toBe('return')
  })

  it('refuses to call something a return because it is a charge', () => {
    // Not a guess either way: 'other' lands on a line that says only that the
    // marketplace charged it, which is all that is known.
    expect(chargeKind('Storage fee for August')).toBe('other')
    expect(chargeKind('Penalty - late dispatch')).toBe('other')
    expect(chargeKind('Charge with no description')).toBe('other')
  })
})
