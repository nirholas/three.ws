// Desk 2: RESEARCH. Every verdict radar forwards is judged by every seat.
// Most of them die here.
//
// When more than one seat clears a coin, the seat with the widest thinnest
// margin claims it (the seat least likely to have been wrong), so each entry
// is owned by exactly one seat and graded against it.

import { evaluateSeat, makeSeat } from '../seats.js';

export class Research {
	constructor({ bus, config, counters, state, now = Date.now() }) {
		this.bus = bus;
		this.counters = counters;
		this.seats = state.seats?.length ? state.seats : config.research.seats.map((d) => makeSeat(d, now));
		this.killedBy = state.killedBy ?? {};
		this.lastPass = [];
	}

	seat(id) {
		return this.seats.find((s) => s.id === id);
	}

	/** Judge one verdict. Returns the claim, or null when every seat said no. */
	judge(coin, now = Date.now()) {
		let claim = null;
		for (const seat of this.seats) {
			seat.stats.seen += 1;
			const verdict = evaluateSeat(seat, coin, now);
			if (!verdict.pass) {
				const failed = verdict.checks.find((c) => !c.pass);
				if (failed) this.killedBy[failed.key] = (this.killedBy[failed.key] ?? 0) + 1;
				continue;
			}
			seat.stats.passed += 1;
			const thinnest = Math.min(...verdict.checks.map((c) => c.margin));
			if (!claim || thinnest > claim.thinnest) claim = { seat, checks: verdict.checks, thinnest };
		}
		return claim;
	}

	async onVerdict(coin) {
		const claim = this.judge(coin);
		if (!claim) return;
		this.counters.cleared += 1;
		claim.seat.stats.claimed += 1;
		const pass = { t: Date.now(), mint: coin.mint, symbol: coin.symbol, seat: claim.seat.id, score: coin.score, tier: coin.tier };
		this.lastPass = [pass, ...this.lastPass].slice(0, 30);
		this.bus.note(
			'RESEARCH',
			claim.seat.id,
			`${coin.symbol || coin.mint.slice(0, 6)} cleared: score ${coin.score} ${coin.tier}, rug ${coin.rug_risk ?? '?'}, give-back ${coin.give_back_risk ?? '?'}`,
			{ mint: coin.mint },
		);
		await this.bus.publish('candidate', { coin, seat: claim.seat, checks: claim.checks });
	}

	toJSON() {
		return { seats: this.seats, killedBy: this.killedBy };
	}
}
