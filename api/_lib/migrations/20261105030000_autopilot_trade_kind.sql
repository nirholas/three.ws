-- Autopilot trade proposals: widen the proposal kind CHECK so an agent can
-- queue a discretionary swap (buy with SOL, or sell a non-$THREE token) for the
-- owner to confirm. Idempotent: the constraint is dropped and re-added.
alter table agent_autopilot_proposals drop constraint if exists agent_autopilot_proposals_kind_check;
alter table agent_autopilot_proposals
    add constraint agent_autopilot_proposals_kind_check
    check (kind in ('create_alert', 'briefing', 'wallet_transfer', 'trade'));
