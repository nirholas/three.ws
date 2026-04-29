-- =============================================================================
-- Migration 0003: Marketplace (listings, installs, reviews, payouts)
-- =============================================================================

-- Marketplace Listings
CREATE TABLE marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id UUID REFERENCES users(id),
  publisher_org_id UUID REFERENCES organizations(id),
  type TEXT NOT NULL,                           -- 'template', 'plugin', 'voice_pack', 'integration'
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  long_description TEXT,                        -- Markdown
  category TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  icon_url TEXT,
  screenshots TEXT[] DEFAULT '{}',              -- Up to 5
  demo_url TEXT,
  pricing_model TEXT NOT NULL,                  -- 'free', 'one_time', 'monthly', 'usage'
  price_cents INTEGER,
  stripe_price_id TEXT,
  version TEXT NOT NULL,
  min_platform_version TEXT,
  source_url TEXT,
  documentation_url TEXT,
  support_email TEXT,
  manifest JSONB DEFAULT '{}',                  -- Plugin manifest / template config
  status TEXT DEFAULT 'draft',                  -- draft, in_review, published, suspended
  review_notes TEXT,
  install_count INTEGER DEFAULT 0,
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  featured INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_marketplace_listings_slug ON marketplace_listings(slug);
CREATE INDEX idx_marketplace_listings_publisher ON marketplace_listings(publisher_org_id);
CREATE INDEX idx_marketplace_listings_type ON marketplace_listings(type);
CREATE INDEX idx_marketplace_listings_category ON marketplace_listings(category);
CREATE INDEX idx_marketplace_listings_status ON marketplace_listings(status);

-- Full-text search index on name + description
CREATE INDEX idx_marketplace_listings_search ON marketplace_listings
  USING GIN (to_tsvector('english', name || ' ' || description));

-- Marketplace Installs
CREATE TABLE marketplace_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  installed_by UUID REFERENCES users(id),
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active',                 -- active, cancelled, suspended
  config JSONB DEFAULT '{}',
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_marketplace_installs_listing ON marketplace_installs(listing_id);
CREATE INDEX idx_marketplace_installs_org ON marketplace_installs(org_id);

-- Marketplace Reviews
CREATE TABLE marketplace_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  org_id UUID REFERENCES organizations(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  body TEXT,
  helpful_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_marketplace_reviews_listing ON marketplace_reviews(listing_id);
CREATE INDEX idx_marketplace_reviews_user ON marketplace_reviews(user_id);
-- One review per user per listing
CREATE UNIQUE INDEX idx_marketplace_reviews_unique ON marketplace_reviews(listing_id, user_id);

-- Publisher Payouts
CREATE TABLE publisher_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_org_id UUID REFERENCES organizations(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  gross_revenue_cents INTEGER NOT NULL DEFAULT 0,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  net_payout_cents INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_id TEXT,
  status TEXT DEFAULT 'pending',                -- pending, processing, completed, failed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_publisher_payouts_org ON publisher_payouts(publisher_org_id);
CREATE INDEX idx_publisher_payouts_status ON publisher_payouts(status);


