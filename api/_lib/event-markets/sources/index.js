// Registry of event sources the auto-open cron reads. Adding a source is one file
// exporting { sourceKind, listEvents } plus one line here.
//
// Not listed on purpose: `launch_cohort` and seasons. No table in this codebase
// records a cohort or season with entrants and a defined winner yet; the day one
// does, its adapter goes here and the cron picks it up with no other change.

import * as arenaTournaments from './arena-tournaments.js';
import * as platformEvent from './platform-event.js';
import * as buildRounds from './build-rounds.js';
import * as bounties from './bounties.js';

export const SOURCES = Object.freeze([arenaTournaments, platformEvent, buildRounds, bounties]);
