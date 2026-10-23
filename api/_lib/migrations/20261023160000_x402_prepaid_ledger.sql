begin;

-- x402 prepaid balances settled on-chain in batches.
--
--   x402_prepaid_accounts  one row per (payer, network, asset). balance_atomic
--                          is the spendable balance; the CHECK makes a negative
--                          balance impossible even if a code path forgets the guard.
--   x402_prepaid_entries   append-mostly journal. A deposit is one on-chain
--                          payment (ref = tx signature). A debit is one paid
--                          request (ref = request id): reserved while the handler
--                          runs, committed on success, refunded on 5xx / cancel /
--                          stale. Only committed debits are ever settled.
--   x402_prepaid_batches   one row per payee per settlement window. A batch claims
--                          its committed debits (entries.batch_id) in the same
--                          statement that creates it, so a debit is in at most one
--                          batch.

create table if not exists x402_prepaid_accounts (
	payer          text        not null,
	network        text        not null,
	asset          text        not null,
	balance_atomic bigint      not null default 0 check (balance_atomic >= 0),
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now(),
	primary key (payer, network, asset)
);

create table if not exists x402_prepaid_batches (
	id           uuid        primary key,
	payee        text        not null,
	network      text        not null,
	asset        text        not null,
	total_atomic bigint      not null check (total_atomic > 0),
	debit_count  integer     not null check (debit_count > 0),
	status       text        not null default 'pending'
		check (status in ('pending', 'confirmed', 'failed', 'unconfirmed')),
	tx_signature text,
	error        text,
	created_at   timestamptz not null default now(),
	settled_at   timestamptz
);

create index if not exists x402_prepaid_batches_open_idx
	on x402_prepaid_batches (status, created_at) where status in ('pending', 'unconfirmed');

create table if not exists x402_prepaid_entries (
	id            bigserial   primary key,
	kind          text        not null check (kind in ('deposit', 'debit')),
	payer         text        not null,
	network       text        not null,
	asset         text        not null,
	amount_atomic bigint      not null check (amount_atomic > 0),
	ref           text        not null,
	state         text        not null
		check (state in ('credited', 'reserved', 'committed', 'refunded')),
	payee         text,
	route         text,
	batch_id      uuid        references x402_prepaid_batches (id),
	refund_reason text,
	created_at    timestamptz not null default now(),
	resolved_at   timestamptz,
	unique (kind, ref),
	check (
		(kind = 'deposit' and state = 'credited' and payee is null)
		or (kind = 'debit' and state <> 'credited' and payee is not null)
	)
);

create index if not exists x402_prepaid_entries_unsettled_idx
	on x402_prepaid_entries (payee, network, asset)
	where kind = 'debit' and state = 'committed' and batch_id is null;

create index if not exists x402_prepaid_entries_reserved_idx
	on x402_prepaid_entries (created_at) where state = 'reserved';

create index if not exists x402_prepaid_entries_payer_idx
	on x402_prepaid_entries (payer, network, asset, created_at desc);

commit;
