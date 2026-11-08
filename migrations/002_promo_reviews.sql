-- Promo-kodlar, mijoz sharhlari

CREATE TABLE promo_codes (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value       NUMERIC(20,2) NOT NULL CHECK (value > 0),
  services    TEXT[],                       -- NULL: barcha xizmatlar
  expires_at  TIMESTAMPTZ,
  max_uses    INT CHECK (max_uses IS NULL OR max_uses > 0),
  used_count  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100)
);
CREATE UNIQUE INDEX promo_codes_code_idx ON promo_codes (upper(code));

CREATE TABLE promo_redemptions (
  id           BIGSERIAL PRIMARY KEY,
  promo_id     BIGINT NOT NULL REFERENCES promo_codes(id),
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  order_id     BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  discount     NUMERIC(20,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (promo_id, customer_id)            -- bitta mijoz bitta kodni bir marta ishlatadi
);

ALTER TABLE orders ADD COLUMN promo_code TEXT, ADD COLUMN discount NUMERIC(20,2) NOT NULL DEFAULT 0;

CREATE TABLE reviews (
  id           BIGSERIAL PRIMARY KEY,
  order_id     BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  rating       INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text         TEXT NOT NULL CHECK (length(text) BETWEEN 2 AND 1000),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX reviews_status_idx ON reviews (status, created_at DESC);
