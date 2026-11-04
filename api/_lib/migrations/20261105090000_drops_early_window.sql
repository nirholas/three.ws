-- Early-access window on generative drops.
--
-- early_minutes is the length of the holder-only window the creator chose
-- (0 = no window). public_opens_at is stamped when the drop is published
-- (now + early_minutes) and is the instant the reveal endpoint stops requiring
-- a Gold-tier $THREE hold. Both are nullable: a row with public_opens_at NULL
-- predates the feature and is open to everyone, exactly as before.
alter table drops add column if not exists early_minutes integer
	check (early_minutes is null or (early_minutes >= 0 and early_minutes <= 10080));
alter table drops add column if not exists public_opens_at timestamptz;
