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
  CREATE TABLE IF NOT EXISTS meesho_facts (
    month TEXT NOT NULL,
    basis TEXT NOT NULL DEFAULT 'order',   -- order | settlement
    data  JSONB NOT NULL,
    PRIMARY KEY (month, basis)
  );

  -- Migrate a database created before Meesho carried two bases. The column is
  -- backfilled from the stored object so a row already tagged with a basis
  -- keeps it, and the single-column primary key is swapped for the pair.
  ALTER TABLE meesho_facts ADD COLUMN IF NOT EXISTS basis TEXT NOT NULL DEFAULT 'order';
  UPDATE meesho_facts SET basis = COALESCE(data->>'basis', 'order')
   WHERE basis IS DISTINCT FROM COALESCE(data->>'basis', 'order');
  IF EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relname = 'meesho_facts' AND i.indisprimary AND i.indnatts = 1
  ) THEN
    ALTER TABLE meesho_facts DROP CONSTRAINT meesho_facts_pkey;
    ALTER TABLE meesho_facts ADD PRIMARY KEY (month, basis);
  END IF;

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
    source_file   TEXT NOT NULL,
    source_row    INTEGER NOT NULL,
    sub_order_id  TEXT NOT NULL,
    sku           TEXT NOT NULL DEFAULT '',
    order_date    TEXT NOT NULL DEFAULT '',
    dispatch_date TEXT NOT NULL DEFAULT '',
    payment_date  TEXT NOT NULL DEFAULT '',
    order_status  TEXT NOT NULL DEFAULT '',
    event_type    TEXT NOT NULL,
    confidence    TEXT NOT NULL,
    -- Set by the importer, not re-derived here: a cancelled row is certain
    -- about what it is and still needs a person to confirm its treatment.
    flagged       BOOLEAN NOT NULL DEFAULT false,
    classification_reason TEXT NOT NULL DEFAULT '',
    quantity      DOUBLE PRECISION NOT NULL DEFAULT 0,
    sale_amount   DOUBLE PRECISION NOT NULL DEFAULT 0,
    return_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    settlement_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    recovery      DOUBLE PRECISION NOT NULL DEFAULT 0,
    recovery_reason TEXT NOT NULL DEFAULT '',
    import_id     TEXT NOT NULL DEFAULT '',
    -- The whole normalized transaction plus its untouched original row, so a
    -- figure can always be traced to the cell it came from.
    data          JSONB NOT NULL,
    PRIMARY KEY (source_file, source_row)
  );

  -- Columns added after this table first shipped. CREATE TABLE IF NOT EXISTS
  -- silently skips an existing table, so a new column has to be added
  -- explicitly or it never reaches a database that already has the table.
  ALTER TABLE meesho_transactions ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;

  CREATE INDEX IF NOT EXISTS meesho_transactions_order_month_idx ON meesho_transactions (left(order_date, 7));
  CREATE INDEX IF NOT EXISTS meesho_transactions_payment_month_idx ON meesho_transactions (left(payment_date, 7));
  CREATE INDEX IF NOT EXISTS meesho_transactions_confidence_idx ON meesho_transactions (confidence);
  CREATE INDEX IF NOT EXISTS meesho_transactions_flagged_idx ON meesho_transactions (flagged) WHERE flagged;

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
