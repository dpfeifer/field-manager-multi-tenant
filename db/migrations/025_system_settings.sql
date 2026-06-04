-- Singleton row for system-wide config. Lets staff manage founder
-- pricing (and future system knobs) from the System page without
-- having to touch environment variables.
CREATE TABLE system_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  stripe_founder_coupon_id TEXT,
  founder_total_seats INT NOT NULL DEFAULT 10,
  founder_price NUMERIC(10,2) NOT NULL DEFAULT 19,
  listed_price NUMERIC(10,2) NOT NULL DEFAULT 29,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO system_settings (id) VALUES (1);
