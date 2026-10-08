import type { BlinkitPnlFacts } from '@/data/models'
import { buildFeeTrend, rankFeeTrends, type FeeTrend, type FeeTrendDef } from './feeTrend'

/**
 * Blinkit's charges, read month by month.
 *
 * The statement answers "what did this cost". It cannot answer "is it getting
 * worse", and on Blinkit that is the question with an answer worth having:
 * the storage charge is levied per unit per day on stock sitting in a dark
 * store, sold or not, and on the owner's August archive it was 57% of net
 * revenue against 2.4% of commission. A rate card is a rate card. Ageing
 * stock is a decision about what to send and what to pull back.
 *
 * Every name here is the one Blinkit's own statement uses, taken from
 * `BLINKIT_LINE_DEFS`, so a charge is called the same thing on the statement
 * and on this screen.
 *
 * Charges only, ex-GST. The GST on them is a separate line of the statement
 * and is reclaimed, so including it would overstate what each one costs.
 *
 * There is no per-product view, and that is a property of the file rather
 * than a gap here. The archive does carry the ageing charge per item, but
 * only each month's totals are stored, so naming the products behind a charge
 * would mean splitting it by guesswork.
 */
export type BlinkitFeeDef = FeeTrendDef<BlinkitPnlFacts>
export type BlinkitFeeSeries = FeeTrend<BlinkitPnlFacts>

export const BLINKIT_FEE_LINES: BlinkitFeeDef[] = [
  {
    id: 'storageCharge',
    label: 'Storage / ageing charge',
    lever: 'Charged per unit per day on stock sitting in Blinkit’s dark stores, sold or not — clear it or stop sending it',
  },
  {
    id: 'upfrontStorage',
    label: 'Upfront storage charge',
    lever: 'Charged on inwarding, for the first 30 days — driven by how much is sent in at once',
  },
  {
    id: 'recallCharge',
    label: 'Recall charge',
    lever: 'Charged when stock is pulled back out of a dark store, so it is the cost of undoing an over-send',
  },
  {
    id: 'courierCharge',
    label: 'Courier charge',
    lever: 'The freight on stock moved in and out, recalls included',
  },
  {
    id: 'customerReturnCharge',
    label: 'Customer return charge',
    lever: 'Driven by the return rate — which is a listing and packaging question',
  },
  { id: 'otherDeductions', label: 'Other deductions' },

  // No lever: both are a percentage of what sells, so they move with sales
  // rather than with anything that can be decided.
  { id: 'commission', label: 'Commission' },
  { id: 'shipping', label: 'Shipping' },

  { id: 'adsRefund', label: 'Ads refund', isCredit: true },
  { id: 'lostDamagedCompensation', label: 'Lost / damaged stock compensation', isCredit: true },
  { id: 'otherCreditDebitNote', label: 'Other credit / debit notes', isCredit: true },
]

export function buildBlinkitFeeSeries(def: BlinkitFeeDef, months: string[], facts: BlinkitPnlFacts[]): BlinkitFeeSeries {
  return buildFeeTrend(def, months, facts)
}

/** Every charge raised across the period, the ones with a lever first. */
export function blinkitFeeSeries(months: string[], facts: BlinkitPnlFacts[]): BlinkitFeeSeries[] {
  return rankFeeTrends(BLINKIT_FEE_LINES.map((def) => buildFeeTrend(def, months, facts)))
}
