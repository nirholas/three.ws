-- x402 Checkout — hosted-link SKUs.
--
-- A SKU is a hosted checkout link a merchant creates in their dashboard. It
-- captures a target paid endpoint, branding, and post-payment redirect, so the
-- buyer-facing URL `/pay/c/<slug>` can render a clean checkout page without
-- the merchant writing any frontend code.
--
-- Each SKU is owned by a single user. The slug is unique globally so the
-- hosted link can be a single short path.
--
-- x402_checkout_calls records every successful paid call against a SKU so
-- the dashboard can surface revenue + click-through. Failed attempts are not
-- recorded (we never see them — the buyer's wallet rejected before settle).

CREATE TABLE IF NOT EXISTS x402_skus (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id     uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- public-facing identifier; the URL is /pay/c/<slug>
    slug              text          NOT NULL UNIQUE
                                    CONSTRAINT x402_skus_slug_format
                                    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),

    -- target endpoint this SKU charges for; must be a 402-enabled URL
    target_endpoint   text          NOT NULL,
    target_method     text          NOT NULL DEFAULT 'GET'
                                    CHECK (target_method IN ('GET', 'POST')),
    target_body       jsonb,                 -- POST body, when applicable

    -- branding shown in the modal + hosted page
    merchant_name     text          NOT NULL,
    action_name       text          NOT NULL,
    description       text,                  -- optional longer copy on the hosted page
    logo_url          text,                  -- optional merchant logo (https only enforced in API)
    accent_color      text          DEFAULT '#0a84ff'
                                    CHECK (accent_color ~* '^#[0-9a-f]{6}$'),

    -- post-payment redirect; if NULL we render the response inline
    success_url       text,

    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    archived_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_x402_skus_owner ON x402_skus (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x402_skus_active ON x402_skus (slug) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS x402_checkout_calls (
    id                bigserial     PRIMARY KEY,
    sku_id            uuid          NOT NULL REFERENCES x402_skus(id) ON DELETE CASCADE,
    paid_at           timestamptz   NOT NULL DEFAULT now(),

    -- on-chain settlement
    network           text          NOT NULL,           -- CAIP-2 id e.g. 'eip155:8453' or 'solana:...'
    tx_signature      text,                              -- the on-chain tx hash from facilitator settle
    payer_address     text,                              -- buyer's wallet
    amount_atomics    text          NOT NULL,            -- raw token units (string, fits bigint)
    asset             text          NOT NULL,            -- token contract / mint address

    -- merchant endpoint outcome
    response_status   int           NOT NULL,            -- HTTP status returned to the buyer
    error_code        text,                              -- when response_status >= 400

    -- traceback for support
    buyer_ip_hash     text,
    user_agent        text
);

CREATE INDEX IF NOT EXISTS idx_x402_checkout_calls_sku
    ON x402_checkout_calls (sku_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_x402_checkout_calls_recent
    ON x402_checkout_calls (paid_at DESC);
