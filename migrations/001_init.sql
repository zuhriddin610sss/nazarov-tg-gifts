-- NAZAROVtggifts: boshlang'ich sxema
-- Pul miqdorlari so'mda, NUMERIC(20,2) (tiyingacha aniqlik).

CREATE TABLE customers (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL UNIQUE,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  lang          TEXT NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz','ru','en','zh')),
  balance       NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_username_idx ON customers (lower(username));

-- O'zgarmas balans jurnali. Har bir yozuv balansni o'zgartiradi (amount > 0 kirim, < 0 chiqim).
CREATE TABLE balance_ledger (
  id               BIGSERIAL PRIMARY KEY,
  customer_id      BIGINT NOT NULL REFERENCES customers(id),
  amount           NUMERIC(20,2) NOT NULL CHECK (amount <> 0),
  balance_after    NUMERIC(20,2) NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('topup','order_payment','refund','admin_credit','admin_debit','installment_payment')),
  ref_type         TEXT,
  ref_id           BIGINT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  note             TEXT,
  created_by       TEXT NOT NULL DEFAULT 'system',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX balance_ledger_customer_idx ON balance_ledger (customer_id, created_at DESC);

CREATE TABLE topup_receipts (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  amount       NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  file_name    TEXT NOT NULL,
  file_mime    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note   TEXT,
  ledger_id    BIGINT REFERENCES balance_ledger(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX topup_receipts_status_idx ON topup_receipts (status, created_at);

CREATE TABLE orders (
  id                BIGSERIAL PRIMARY KEY,
  public_id         TEXT NOT NULL UNIQUE,
  customer_id       BIGINT NOT NULL REFERENCES customers(id),
  service           TEXT NOT NULL CHECK (service IN ('nft_gift','gift_rent','username_rent','number_rent','premium','stars')),
  payment_method    TEXT NOT NULL CHECK (payment_method IN ('cash','installment')),
  installment_type  TEXT,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','completed','cancelled')),
  title             TEXT NOT NULL,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipient         TEXT,
  price             NUMERIC(20,2),          -- NULL: narxni admin aytadi
  cost              NUMERIC(20,2),          -- faqat admin uchun (tannarx, so'mda)
  paid_amount       NUMERIC(20,2) NOT NULL DEFAULT 0,
  customer_username TEXT,
  customer_phone    TEXT,
  idempotency_key   TEXT NOT NULL,
  queued_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  closed_at         TIMESTAMPTZ,
  admin_note        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key),
  CHECK ((status = 'queued') = (closed_at IS NULL))
);
CREATE INDEX orders_queue_idx ON orders (queued_at, id) WHERE status = 'queued';
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

-- Navbat raqami saqlanmaydi: faqat shu view orqali hisoblanadi (bo'shliq va takror bo'lmaydi).
CREATE VIEW order_queue AS
  SELECT o.id, ROW_NUMBER() OVER (ORDER BY o.queued_at, o.id) AS position
  FROM orders o WHERE o.status = 'queued';

CREATE TABLE installment_agreements (
  id               BIGSERIAL PRIMARY KEY,
  order_id         BIGINT UNIQUE REFERENCES orders(id),
  customer_id      BIGINT REFERENCES customers(id),
  legacy           BOOLEAN NOT NULL DEFAULT false,
  client_name      TEXT,
  client_username  TEXT,
  client_phone     TEXT,
  product_name     TEXT NOT NULL,
  installment_type TEXT,
  total_price      NUMERIC(20,2) NOT NULL CHECK (total_price > 0),
  down_payment     NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
  monthly_payment  NUMERIC(20,2) NOT NULL CHECK (monthly_payment > 0),
  start_date       DATE NOT NULL,
  final_date       DATE NOT NULL,
  collateral       TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (final_date >= start_date),
  CHECK (down_payment <= total_price)
);

CREATE TABLE installment_payments (
  id               BIGSERIAL PRIMARY KEY,
  agreement_id     BIGINT NOT NULL REFERENCES installment_agreements(id),
  amount           NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  source           TEXT NOT NULL CHECK (source IN ('balance','manual')),
  ledger_id        BIGINT REFERENCES balance_ledger(id),
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  note             TEXT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_by       TEXT NOT NULL
);
CREATE INDEX installment_payments_agreement_idx ON installment_payments (agreement_id, paid_at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- Takroriy Telegram xabarlarini oldini olish
CREATE TABLE notifications_sent (
  key        TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE error_log (
  id         BIGSERIAL PRIMARY KEY,
  source     TEXT NOT NULL,
  message    TEXT NOT NULL,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
