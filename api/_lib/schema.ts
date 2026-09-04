/**
 * The database schema, as a single DO block so it can be sent as one
 * statement — database consoles and prepared statements both reject
 * multi-statement input ("cannot insert multiple commands into a prepared
 * statement").
 *
 * This is the single source of truth for the schema: the first-run setup
 * endpoint (api/setup.ts) and the `npm run init-db` script both apply it.
 *
 * Safe to re-run: every statement inside is CREATE ... IF NOT EXISTS.
 */
export const SCHEMA_SQL = `
DO $schema$
BEGIN
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

  -- ---------------------------------------------------------------------------
  -- Product master — COGS here is the single source of truth for every P&L.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS sku_master (
    sku                    TEXT PRIMARY KEY,
    product_name           TEXT NOT NULL,
    category               TEXT NOT NULL,
    sub_category           TEXT,
    brand                  TEXT NOT NULL,
    cogs                   DOUBLE PRECISION NOT NULL DEFAULT 0,
    mrp                    DOUBLE PRECISION NOT NULL DEFAULT 0,
    launch_date            TEXT NOT NULL,
    status                 TEXT NOT NULL,
    lead_time_days         INTEGER NOT NULL DEFAULT 21,
    safety_stock           INTEGER NOT NULL DEFAULT 0
  );

  -- ---------------------------------------------------------------------------
  -- Effective-dated COGS. A cost belongs to a SKU *in a month*, not to a SKU,
  -- so closing a month freezes the cost that applied to it. Rows are never
  -- updated in place except to correct a version with the same effective
  -- month, which is what makes a mis-keyed cost sheet fixable without
  -- disturbing any other month.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS cost_versions (
    sku            TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    cogs           DOUBLE PRECISION NOT NULL,
    source         TEXT NOT NULL,
    note           TEXT,
    file_name      TEXT,
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by    TEXT,
    PRIMARY KEY (sku, effective_from)
  );

  CREATE INDEX IF NOT EXISTS cost_versions_sku_idx ON cost_versions (sku, effective_from DESC);

  -- ---------------------------------------------------------------------------
  -- Advertising spend entered by hand, for platforms that bill by monthly
  -- invoice rather than publishing a campaign report. Kept apart from
  -- ads_records so a manual figure can never be mistaken for a measured one.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS manual_ad_spend (
    channel     TEXT NOT NULL,
    month       TEXT NOT NULL,
    amount      DOUBLE PRECISION NOT NULL,
    file_name   TEXT,
    note        TEXT,
    entered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    entered_by  TEXT,
    PRIMARY KEY (channel, month)
  );

  -- ---------------------------------------------------------------------------
  -- Import audit trail. uploaded_by is recorded from the first upload onwards so
  -- history stays attributable.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS imports (
    id                  TEXT PRIMARY KEY,
    file_name           TEXT NOT NULL,
    channel             TEXT NOT NULL,
    report_type         TEXT NOT NULL,
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
    record_count        INTEGER NOT NULL DEFAULT 0,
    valid_record_count  INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL,
    warnings            JSONB NOT NULL DEFAULT '[]'::jsonb
  );

  -- ---------------------------------------------------------------------------
  -- Sales + ads rows. dedup_key holds the same key the client already computes
  -- (recordKey / adsRecordKey in src/data/normalize/dedupKeys.ts); the UNIQUE
  -- constraint plus ON CONFLICT DO NOTHING makes de-duplication atomic even when
  -- two people import at the same moment.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS sales_records (
    dedup_key       TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL,
    order_date      TEXT NOT NULL,
    channel         TEXT NOT NULL,
    marketplace     TEXT NOT NULL,
    seller_type     TEXT NOT NULL,
    sku             TEXT NOT NULL,
    product_name    TEXT NOT NULL,
    category        TEXT NOT NULL,
    sub_category    TEXT,
    quantity        DOUBLE PRECISION NOT NULL DEFAULT 0,
    gross_sales     DOUBLE PRECISION NOT NULL DEFAULT 0,
    discount        DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_sales       DOUBLE PRECISION NOT NULL DEFAULT 0,
    return_units    DOUBLE PRECISION NOT NULL DEFAULT 0,
    rto_units       DOUBLE PRECISION NOT NULL DEFAULT 0,
    shipping_cost   DOUBLE PRECISION NOT NULL DEFAULT 0,
    marketplace_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
    tax             DOUBLE PRECISION NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    currency        TEXT NOT NULL,
    raw             JSONB,
    import_id       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sales_records_order_date_idx ON sales_records (order_date);
  CREATE INDEX IF NOT EXISTS sales_records_channel_idx    ON sales_records (channel);
  CREATE INDEX IF NOT EXISTS sales_records_sku_idx        ON sales_records (sku);

  CREATE TABLE IF NOT EXISTS ads_records (
    dedup_key   TEXT PRIMARY KEY,
    date        TEXT NOT NULL,
    channel     TEXT NOT NULL,
    campaign    TEXT NOT NULL,
    ad_group    TEXT,
    keyword     TEXT,
    search_term TEXT,
    sku         TEXT,
    asin        TEXT,
    impressions DOUBLE PRECISION NOT NULL DEFAULT 0,
    clicks      DOUBLE PRECISION NOT NULL DEFAULT 0,
    spend       DOUBLE PRECISION NOT NULL DEFAULT 0,
    ad_sales    DOUBLE PRECISION NOT NULL DEFAULT 0,
    ad_orders   DOUBLE PRECISION NOT NULL DEFAULT 0,
    import_id   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ads_records_date_idx ON ads_records (date);

  -- ---------------------------------------------------------------------------
  -- Channel-native P&L facts, stored whole as JSONB per month. The app always
  -- reads/writes a month's facts as one object and never queries into individual
  -- fields in SQL, so JSONB avoids a schema migration each time a fact field is
  -- added (as happened when Meesho gained its \`ads\` line).
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS flipkart_facts (
    month TEXT PRIMARY KEY,
    data  JSONB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS amazon_usa_facts (
    month TEXT PRIMARY KEY,
    data  JSONB NOT NULL
  );

  -- Meesho alone carries two statements per month: the same orders bucketed by
  -- order date and by payment date. Keying on month alone made the second one
  -- written overwrite the first, so only one basis ever survived and the
  -- page's basis toggle had nothing to switch between.
  -- Meesho's monthly figures are no longer stored: they are summed from the
  -- individual events in meesho_transactions, so a row repeated across uploads
  -- cannot be counted twice. The table is dropped so nothing can read a stale
  -- pre-aggregated copy alongside the live one.
  DROP TABLE IF EXISTS meesho_facts;


  -- ---------------------------------------------------------------------------
  -- The individual Meesho events behind the monthly facts above.
  --
  -- Kept out of the main state payload deliberately: one month is roughly two
  -- thousand rows and the dashboard loads its whole dataset in one request, so
  -- these are queried on demand instead. Keyed on the source file and row, so
  -- re-uploading a file replaces exactly the rows it produced and a second file
  -- covering overlapping orders does not silently double them.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS meesho_transactions (
    -- A row's own identity, not the file it arrived in. Meesho's "previous
    -- aggregated payment" downloads repeat earlier rows, so the same event
    -- arrives in several files; keyed this way it is stored once however many
    -- times it is uploaded. Sub-order alone is not enough — a sub-order
    -- legitimately has a sale row and a return row.
    sub_order_id    TEXT NOT NULL,
    transaction_ref TEXT NOT NULL,
    sku             TEXT NOT NULL DEFAULT '',
    order_date      TEXT NOT NULL DEFAULT '',
    dispatch_date   TEXT NOT NULL DEFAULT '',
    payment_date    TEXT NOT NULL DEFAULT '',
    order_status    TEXT NOT NULL DEFAULT '',
    event_type      TEXT NOT NULL,
    confidence      TEXT NOT NULL,
    flagged         BOOLEAN NOT NULL DEFAULT false,
    classification_reason TEXT NOT NULL DEFAULT '',
    quantity        DOUBLE PRECISION NOT NULL DEFAULT 0,
    sale_amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
    return_amount   DOUBLE PRECISION NOT NULL DEFAULT 0,
    settlement_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    recovery        DOUBLE PRECISION NOT NULL DEFAULT 0,
    recovery_reason TEXT NOT NULL DEFAULT '',
    source_file     TEXT NOT NULL DEFAULT '',
    source_row      INTEGER NOT NULL DEFAULT 0,
    -- What this row adds to its month. A month is the sum of these.
    contribution    JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- The whole normalized transaction plus its untouched original row.
    data            JSONB NOT NULL,
    PRIMARY KEY (sub_order_id, transaction_ref)
  );

  -- Advertising and platform recovery hang off dates rather than orders, and
  -- repeat across files for the same reason, so each gets the natural key of
  -- the row it came from.
  CREATE TABLE IF NOT EXISTS meesho_ads (
    deduction_duration TEXT NOT NULL,
    deduction_date     TEXT NOT NULL,
    campaign_id        TEXT NOT NULL,
    spend_ex_gst       DOUBLE PRECISION NOT NULL DEFAULT 0,
    credits            DOUBLE PRECISION NOT NULL DEFAULT 0,
    gst                DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (deduction_duration, deduction_date, campaign_id)
  );

  CREATE TABLE IF NOT EXISTS meesho_platform_recovery (
    entry_date   TEXT NOT NULL,
    program_name TEXT NOT NULL,
    amount       DOUBLE PRECISION NOT NULL DEFAULT 0,
    reason       TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (entry_date, program_name)
  );

  -- Migrations for a database that already has these tables. CREATE TABLE IF
  -- NOT EXISTS skips an existing one, so anything added later has to be added
  -- explicitly. These run before the indexes below, because an index over a
  -- column that has not been added yet fails outright.
  ALTER TABLE meesho_transactions ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE meesho_transactions ADD COLUMN IF NOT EXISTS transaction_ref TEXT NOT NULL DEFAULT '';
  ALTER TABLE meesho_transactions ADD COLUMN IF NOT EXISTS contribution JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE meesho_transactions ADD COLUMN IF NOT EXISTS source_file TEXT NOT NULL DEFAULT '';
  ALTER TABLE meesho_transactions ADD COLUMN IF NOT EXISTS source_row INTEGER NOT NULL DEFAULT 0;

  -- Re-key a table that identified a row by the file it arrived in. Rows
  -- stored that way may already be duplicated across Meesho's overlapping
  -- downloads, so they are cleared rather than migrated: the figures they
  -- carry cannot be trusted, and re-uploading the files rebuilds them.
  IF EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE c.relname = 'meesho_transactions' AND i.indisprimary AND a.attname = 'source_file'
  ) THEN
    DELETE FROM meesho_transactions;
    ALTER TABLE meesho_transactions DROP CONSTRAINT meesho_transactions_pkey;
    ALTER TABLE meesho_transactions ADD PRIMARY KEY (sub_order_id, transaction_ref);
  END IF;

  CREATE INDEX IF NOT EXISTS meesho_transactions_order_month_idx ON meesho_transactions (left(order_date, 7));
  CREATE INDEX IF NOT EXISTS meesho_transactions_payment_month_idx ON meesho_transactions (left(payment_date, 7));
  CREATE INDEX IF NOT EXISTS meesho_transactions_flagged_idx ON meesho_transactions (flagged) WHERE flagged;

  -- ---------------------------------------------------------------------------
  -- The USD→INR rate that applied in each month.
  --
  -- Amazon USA is denominated in dollars, so this one number scales the whole
  -- channel — revenue and cost alike — wherever it rolls into the rupee P&L.
  -- Held per month rather than as a constant so a closed month keeps the rate
  -- it was closed on, exactly like an effective-dated cost.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS fx_rates (
    month      TEXT NOT NULL,
    pair       TEXT NOT NULL DEFAULT 'USDINR',
    rate       DOUBLE PRECISION NOT NULL,
    note       TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (month, pair)
  );

  -- ---------------------------------------------------------------------------
  -- Operational data entered outside marketplace reports.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS inventory_snapshots (
    sku           TEXT NOT NULL,
    as_of_date    TEXT NOT NULL,
    current_stock DOUBLE PRECISION NOT NULL DEFAULT 0,
    in_transit    DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (sku, as_of_date)
  );

  CREATE TABLE IF NOT EXISTS fixed_expenses (
    month    TEXT NOT NULL,
    category TEXT NOT NULL,
    amount   DOUBLE PRECISION NOT NULL DEFAULT 0,
    note     TEXT,
    PRIMARY KEY (month, category)
  );

  -- -------------------------------------------------------------------------
  -- Marketplace SKU codes are not the internal cost-master codes: a listing may
  -- be a renamed single, a multipack, or a bundle of different products.
  -- Without these two tables such codes fall back to costing a flat percentage
  -- of revenue, which on real Flipkart data covered about half of all sales.
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS sku_map (
    channel_sku  TEXT PRIMARY KEY,
    internal_sku TEXT NOT NULL,
    kind         TEXT NOT NULL,              -- SINGLE | COMBO
    source       TEXT NOT NULL,              -- imported | derived | manual
    -- Derived mappings are guesses from the shape of the code and stay
    -- unverified until a person confirms them.
    verified     BOOLEAN NOT NULL DEFAULT false,
    note         TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS combo_components (
    combo_sku     TEXT NOT NULL,
    component_sku TEXT NOT NULL,
    quantity      DOUBLE PRECISION NOT NULL DEFAULT 1,
    source        TEXT NOT NULL,
    PRIMARY KEY (combo_sku, component_sku)
  );

  CREATE INDEX IF NOT EXISTS combo_components_combo_idx ON combo_components (combo_sku);
END
$schema$;
`
