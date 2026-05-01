-- rider_passes: tracks wallets that have sent 8,000 $THREE to the vault.
-- Populated by the Helius webhook at /api/rider/webhook.

begin;

create table if not exists rider_passes (
  wallet_address text primary key,
  amount_paid    numeric not null,
  tx_signature   text not null unique,
  created_at     timestamptz not null default now()
);

commit;
