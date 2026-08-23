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
    standard_selling_price DOUBLE PRECISION NOT NULL DEFAULT 0,
    launch_date            TEXT NOT NULL,
    status                 TEXT NOT NULL,
    lead_time_days         INTEGER NOT NULL DEFAULT 21,
    minimum_stock          INTEGER NOT NULL DEFAULT 0,
    safety_stock           INTEGER NOT NULL DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS meesho_facts (
    month TEXT PRIMARY KEY,
    data  JSONB NOT NULL
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
END
$schema$;
`
