/** The reminder a runtime hands the model to persist anything worth keeping. */
export declare const MEMORY_NUDGE: string;
/** Default cadence: a nudge every this many user turns. */
export declare const DEFAULT_NUDGE_EVERY_TURNS = 6;
/** How many user messages a transcript holds (the current one included). */
export declare function countUserTurns(messages: Array<{ role: string }> | null | undefined): number;
/** True every `every` user turns (never on turn 1). */
export declare function shouldNudge(userTurns: number, every?: number): boolean;
/** The nudge as a system message, or null when this turn should not carry it. */
export declare function memoryNudgeMessage(o?: {
	messages?: Array<{ role: string }>;
	every?: number;
	final?: boolean;
}): { role: 'system'; content: string } | null;
