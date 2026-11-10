// Ma'lumotlar bazasi sxemasi (SQLite). Jadvallar ish vaqtida CREATE ... IF NOT EXISTS bilan yaratiladi.
// Pul miqdorlari tiyinda (1 so'm = 100 tiyin), butun son.
//
// Pul xavfsizligi: balans faqat `ledger` jadvaliga yozuv qo'shish orqali o'zgaradi.
// Trigger shu INSERT bilan birga, bitta bo'linmas amalda balansni o'zgartiradi va bog'liq
// buyurtma/chek/to'lov holatini yangilaydi. Har qanday tekshiruv yiqilsa — butun amal bekor bo'ladi.
// `idem_key` UNIQUE: bir xil amal ikki marta bajarilmaydi.

export const SCHEMA_VERSION = 2;

const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

export const DDL = [
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL UNIQUE,
    username TEXT, first_name TEXT, last_name TEXT, phone TEXT,
    lang TEXT NOT NULL DEFAULT 'uz',
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
    last_seen_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_customers_username ON customers (lower(username))`,

  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL,
    service TEXT NOT NULL CHECK (service IN ('nft_gift','gift_rent','username_rent','number_rent','premium','stars')),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','installment')),
    installment_type TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending','queued','completed','cancelled','failed')),
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    recipient TEXT,
    price INTEGER,
    cost INTEGER,
    discount INTEGER NOT NULL DEFAULT 0,
    promo_code TEXT,
    paid_amount INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    customer_username TEXT, customer_phone TEXT,
    idem_key TEXT NOT NULL,
    queued_at INTEGER,
    closed_at INTEGER,
    admin_note TEXT,
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
    UNIQUE (customer_id, idem_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_queue ON orders (queued_at, id) WHERE status = 'queued'`,
  `CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at)`,

  `CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    file_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    admin_note TEXT,
    ledger_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
    reviewed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts (status, created_at)`,

  `CREATE TABLE IF NOT EXISTS agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER UNIQUE,
    customer_id INTEGER,
    legacy INTEGER NOT NULL DEFAULT 0,
    client_name TEXT, client_username TEXT, client_phone TEXT,
    product_name TEXT NOT NULL,
    installment_type TEXT,
    total_price INTEGER NOT NULL CHECK (total_price > 0),
    down_payment INTEGER NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
    monthly_payment INTEGER NOT NULL CHECK (monthly_payment > 0),
    start_date TEXT NOT NULL,
    final_date TEXT NOT NULL,
    collateral TEXT, notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
    CHECK (final_date >= start_date),
    CHECK (down_payment <= total_price)
  )`,

  `CREATE TABLE IF NOT EXISTS inst_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id INTEGER NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    source TEXT NOT NULL CHECK (source IN ('balance','manual')),
    ledger_id INTEGER,
    idem_key TEXT NOT NULL UNIQUE,
    note TEXT,
    created_by TEXT NOT NULL,
    paid_at INTEGER NOT NULL DEFAULT (${NOW_MS})
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inst_payments_agr ON inst_payments (agreement_id)`,

  `CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    amount INTEGER NOT NULL CHECK (amount <> 0),
    balance_after INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('topup','order_payment','refund','admin_credit','admin_debit','installment_payment')),
    ref_id INTEGER,
    idem_key TEXT NOT NULL UNIQUE,
    note TEXT,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS})
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_customer ON ledger (customer_id, created_at)`,

  // --- Tekshiruvlar (INSERT dan oldin) ---
  `CREATE TRIGGER IF NOT EXISTS ledger_check BEFORE INSERT ON ledger BEGIN
    SELECT RAISE(ABORT, 'CUSTOMER_NOT_FOUND') WHERE NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id);
    SELECT RAISE(ABORT, 'INSUFFICIENT_BALANCE') WHERE (SELECT balance FROM customers WHERE id = NEW.customer_id) + NEW.amount < 0;
    SELECT RAISE(ABORT, 'BAD_SIGN') WHERE (NEW.kind IN ('topup','refund','admin_credit') AND NEW.amount < 0)
                                       OR (NEW.kind IN ('order_payment','admin_debit','installment_payment') AND NEW.amount > 0);
    SELECT RAISE(ABORT, 'ORDER_STATE') WHERE NEW.kind = 'order_payment'
      AND NOT EXISTS (SELECT 1 FROM orders WHERE id = NEW.ref_id AND customer_id = NEW.customer_id AND status = 'pending');
    SELECT RAISE(ABORT, 'ORDER_ALREADY_CLOSED') WHERE NEW.kind = 'refund'
      AND NOT EXISTS (SELECT 1 FROM orders WHERE id = NEW.ref_id AND customer_id = NEW.customer_id AND status = 'queued' AND paid_amount = NEW.amount);
    SELECT RAISE(ABORT, 'RECEIPT_ALREADY_REVIEWED') WHERE NEW.kind = 'topup'
      AND NOT EXISTS (SELECT 1 FROM receipts WHERE id = NEW.ref_id AND customer_id = NEW.customer_id AND status = 'pending');
    SELECT RAISE(ABORT, 'AGREEMENT_NOT_FOUND') WHERE NEW.kind = 'installment_payment'
      AND NOT EXISTS (SELECT 1 FROM agreements WHERE id = NEW.ref_id AND customer_id = NEW.customer_id AND status = 'active');
  END`,

  // --- Balans va bog'liq holatlar (INSERT bilan bir amalda) ---
  `CREATE TRIGGER IF NOT EXISTS ledger_apply AFTER INSERT ON ledger BEGIN
    UPDATE customers SET balance = balance + NEW.amount WHERE id = NEW.customer_id;
    UPDATE ledger SET balance_after = (SELECT balance FROM customers WHERE id = NEW.customer_id) WHERE id = NEW.id;
    UPDATE orders SET status = 'queued', paid_amount = -NEW.amount, queued_at = ${NOW_MS}
      WHERE NEW.kind = 'order_payment' AND id = NEW.ref_id;
    UPDATE orders SET status = 'cancelled', refunded = NEW.amount, closed_at = ${NOW_MS}
      WHERE NEW.kind = 'refund' AND id = NEW.ref_id;
    UPDATE receipts SET status = 'approved', amount = NEW.amount, ledger_id = NEW.id, reviewed_at = ${NOW_MS}
      WHERE NEW.kind = 'topup' AND id = NEW.ref_id;
    INSERT INTO inst_payments (agreement_id, amount, source, ledger_id, idem_key, created_by)
      SELECT NEW.ref_id, -NEW.amount, 'balance', NEW.id, NEW.idem_key, 'customer:' || NEW.customer_id
      WHERE NEW.kind = 'installment_payment';
  END`,

  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, data TEXT,
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS})
  )`,
  `CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, message TEXT NOT NULL, data TEXT,
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS})
  )`,
  `CREATE TABLE IF NOT EXISTS notif (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL DEFAULT (${NOW_MS}))`,

  `CREATE TABLE IF NOT EXISTS promo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
    value INTEGER NOT NULL CHECK (value > 0),
    services TEXT,
    expires_at INTEGER,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
    CHECK (max_uses IS NULL OR used_count <= max_uses)
  )`,
  `CREATE TABLE IF NOT EXISTS promo_red (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, order_id INTEGER NOT NULL UNIQUE,
    discount INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
    UNIQUE (promo_id, customer_id)
  )`,

  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE, customer_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
    created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
    reviewed_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS rent_seen (
    address TEXT PRIMARY KEY, category TEXT NOT NULL, item TEXT NOT NULL, seen_at INTEGER NOT NULL
  )`,

  // Adminning o'z mahsulotlari ("Reklama"): ijara va sotuv. Narxlar tiyinda.
  `CREATE TABLE IF NOT EXISTS own_products (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('gifts','usernames','numbers')),
    name TEXT NOT NULL,
    image TEXT,
    model TEXT, backdrop TEXT, symbol TEXT,
    rent_enabled INTEGER NOT NULL DEFAULT 0,
    rent_price INTEGER CHECK (rent_price IS NULL OR rent_price > 0),
    rent_min INTEGER, rent_max INTEGER,
    inst_enabled INTEGER NOT NULL DEFAULT 0,
    cash_enabled INTEGER NOT NULL DEFAULT 0,
    cash_price INTEGER CHECK (cash_price IS NULL OR cash_price > 0),
    visible INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
];
