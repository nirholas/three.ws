/**
 * One log line for a tool event, as the live scripts print it. The server
 * emits arguments already parsed (an object), so they are serialized here;
 * a raw string is printed as it came. Arguments are cut at 160 characters.
 */
export function toolLogLine(data) {
	const args = data.arguments == null ? '' : typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments);
	return ['tool', data.name, data.status, args.slice(0, 160)].filter(Boolean).join(' ');
}
