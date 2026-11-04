-- Drop-native Solana mint bookkeeping. The collection and item address columns
-- already exist (20260901120000_generative_drops.sql); this adds what an atomic,
-- retryable mint needs: which network the drop's Core collection lives on, the
-- creation signature, and claim timestamps that act as the lock so two
-- concurrent callers can never both send a transaction.
begin;

alter table drops add column if not exists collection_network text;
alter table drops add column if not exists collection_signature text;
alter table drops add column if not exists collection_claimed_at timestamptz;

alter table drop_items add column if not exists mint_signature text;
alter table drop_items add column if not exists mint_claimed_at timestamptz;
alter table drop_items add column if not exists mint_error text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'drops_collection_network_chk') then
        alter table drops add constraint drops_collection_network_chk
            check (collection_network is null or collection_network in ('mainnet', 'devnet'));
    end if;
end $$;

commit;
