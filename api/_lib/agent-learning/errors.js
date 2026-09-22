// One error type for the learning layer. Routes turn it into the standard
// `{ error, error_description }` envelope; MCP tools turn it into a designed
// tool error. Anything else thrown is a real fault and propagates.

export class LearningError extends Error {
	constructor(status, code, message, extra = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}

export const memoryOffError = () =>
	new LearningError(
		409,
		'memory_disabled',
		'Memory is switched off for this account. The owner can turn it back on at /settings/memory.',
		{ settings_url: '/settings/memory' },
	);
