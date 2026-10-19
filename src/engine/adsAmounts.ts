import type { AdsRecord } from '@/data/models'
import { DEFAULT_FX_INR, inrPerUnit, type FxRatesInr } from '@/data/fxRates'

/**
 * An advertising figure in rupees, whatever the account was billed in.
 *
 * Amazon bills an advertising account in its marketplace's currency: the UAE
 * account in dirhams, the USA account in dollars. Those figures are stored as
 * the file states them, so the conversion happens here, at the month's rate,
 * every time the figure is read.
 *
 * Converting at import was the alternative and it is the wrong one twice
 * over. A rate corrected on Monthly Inputs has to restate the months it
 * applies to, which a frozen number cannot; and Amazon UAE's statement is
 * rendered in dirhams, so a rupee figure would have to be divided back at
 * the same rate to appear on it — a round trip through a rate that may no
 * longer be the one it was multiplied by.
 *
 * A row with no currency is rupees. Every row stored before the column
 * existed is one, including the Amazon USA campaign rows, whose reader
 * converted them at upload.
 */
export function adsAmountInr(
  amount: number,
  currency: AdsRecord['currency'],
  fx: FxRatesInr = DEFAULT_FX_INR,
): number {
  return currency === undefined || currency === 'INR' ? amount : amount * inrPerUnit(currency, fx)
}
