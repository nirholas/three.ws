// Structured single-line JSON logs. Cloud Logging reads `severity` and `message`
// from each line, so a warning or error is filterable without parsing. Message
// text from chats never reaches a log: callers pass ids, platforms and error
// codes only.

function emit(severity, message, meta) {
	const line = JSON.stringify({ severity, message, time: new Date().toISOString(), worker: 'agent-gateway', ...(meta || {}) });
	if (severity === 'ERROR' || severity === 'WARNING') console.error(line);
	else console.log(line);
}

export const log = {
	debug: (message, meta) => { if (process.env.GATEWAY_DEBUG === '1') emit('DEBUG', message, meta); },
	info: (message, meta) => emit('INFO', message, meta),
	warn: (message, meta) => emit('WARNING', message, meta),
	error: (message, meta) => emit('ERROR', message, meta),
};
