import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '@/store/dataStore'
import { distinctCategories, UNCATEGORIZED } from '@/data/categories'

/**
 * Adding a product to the Product Master by hand.
 *
 * Until now the only ways in were a cost-sheet upload and the Uncategorized
 * pile, and the second of those creates a row with a cost of zero — which is a
 * product that silently reports 100% margin. So the cost is asked for here,
 * beside the name, at the moment the row is created.
 *
 * The form pushes back before it saves. Most codes that look like missing
 * products are not: `C2/…` and `C3/…` are Myntra and Flipkart bundle codes, and
 * a code already linked on the SKU Mapping screen resolves to a real product
 * already. Creating a Product Master row for either splits one product's sales
 * across two identities and gives the bundle a cost it cannot have. Both are
 * warned about, and neither is blocked — the owner knows the catalogue.
 */
export function AddProductForm() {
  const { skuMaster, mappings, addProduct } = useDataStore()
  const [open, setOpen] = useState(false)
  const [sku, setSku] = useState('')
  const [productName, setProductName] = useState('')
  const [category, setCategory] = useState('')
  const [cogs, setCogs] = useState('')
  const [mrp, setMrp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const categories = distinctCategories(skuMaster.map((s) => s.category)).filter((c) => c !== UNCATEGORIZED)
  const trimmedSku = sku.trim()
  const existing = skuMaster.find((s) => s.sku === trimmedSku)
  const mappedTo = mappings.find((m) => m.channelSku === trimmedSku)
  // Bundle codes the marketplaces invent. A pack of two is not a new product;
  // it is two of an existing one, which is what the SKU Mapping screen records.
  const looksLikeCombo = /^C\d/i.test(trimmedSku)

  function reset(): void {
    setSku('')
    setProductName('')
    setCategory('')
    setCogs('')
    setMrp('')
    setError(null)
  }

  async function save(): Promise<void> {
    if (!trimmedSku) return setError('A SKU code is required.')
    if (existing) return setError(`${trimmedSku} is already in the Product Master — edit its COGS and MRP in the table below.`)

    setBusy(true)
    setError(null)
    try {
      await addProduct({
        sku: trimmedSku,
        productName: productName.trim() || trimmedSku,
        category: category.trim() || UNCATEGORIZED,
        cogs: Number(cogs) || 0,
        mrp: Number(mrp) || 0,
      })
      setSaved(trimmedSku)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that product.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => { setOpen(true); setSaved(null) }}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90"
        >
          + Add product
        </button>
        {saved && (
          <span className="text-xs text-[var(--good-ink)]">
            Added {saved}. It is in the table below and every P&amp;L will use its cost from now on.
          </span>
        )}
      </div>
    )
  }

  const field = 'w-full rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none'
  const label = 'block text-xs font-medium text-[var(--ink-3)]'

  return (
    <section className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--ink)]">Add a product</h3>
      <p className="mt-1 text-xs text-[var(--ink-2)]">
        Use the Unicommerce SKU code. The cost you enter here is what every channel&apos;s P&amp;L will charge
        against this product, so a row added without one reports the whole sale as margin.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label className={label} htmlFor="add-sku">SKU (Unicommerce)</label>
          <input
            id="add-sku" className={`${field} font-mono`} value={sku} autoComplete="off"
            placeholder="AO/CO/Almond/200" onChange={(e) => setSku(e.target.value)}
          />
        </div>
        <div className="lg:col-span-2">
          <label className={label} htmlFor="add-name">Product name</label>
          <input
            id="add-name" className={field} value={productName} autoComplete="off"
            placeholder="Aravi Organic 100% Pure Cold Pressed Almond Oil - 200 ml"
            onChange={(e) => setProductName(e.target.value)}
          />
        </div>
        <div>
          <label className={label} htmlFor="add-category">Category</label>
          <input
            id="add-category" className={field} value={category} list="product-master-categories"
            autoComplete="off" placeholder="Hair Care" onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="product-master-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label} htmlFor="add-cogs">COGS ₹</label>
            <input
              id="add-cogs" type="number" min="0" step="0.01" className={`${field} text-right tabular-nums`}
              value={cogs} onChange={(e) => setCogs(e.target.value)}
            />
          </div>
          <div>
            <label className={label} htmlFor="add-mrp">MRP ₹</label>
            <input
              id="add-mrp" type="number" min="0" step="0.01" className={`${field} text-right tabular-nums`}
              value={mrp} onChange={(e) => setMrp(e.target.value)}
            />
          </div>
        </div>
      </div>

      {existing && (
        <p className="mt-3 text-xs text-[var(--critical-ink)]">
          {trimmedSku} is already in the Product Master as &ldquo;{existing.productName}&rdquo;. Edit its COGS and MRP in
          the table below rather than adding it again.
        </p>
      )}
      {!existing && mappedTo && (
        <p className="mt-3 text-xs text-[var(--ink-2)]">
          ⚠ {trimmedSku} is already linked to <span className="font-mono">{mappedTo.internalSku}</span> on{' '}
          <Link to="/products/sku-mapping" className="font-semibold underline">SKU Mapping</Link>, so it already has a
          cost and a category. Adding it here would split one product&apos;s sales across two rows.
        </p>
      )}
      {!existing && !mappedTo && looksLikeCombo && (
        <p className="mt-3 text-xs text-[var(--ink-2)]">
          ⚠ {trimmedSku} looks like a bundle code. A pack is not a new product — it is a recipe of products you
          already have, and{' '}
          <Link to="/products/sku-mapping" className="font-semibold underline">SKU Mapping</Link> costs it from its
          components. Only add it here if it really is something new.
        </p>
      )}
      {error && <p className="mt-3 text-xs text-[var(--critical-ink)]">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button" disabled={busy || !trimmedSku || Boolean(existing)} onClick={save}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add to Product Master'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          Cancel
        </button>
        {saved && <span className="text-xs text-[var(--good-ink)]">Added {saved}.</span>}
      </div>
    </section>
  )
}
