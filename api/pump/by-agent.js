// Thin stub that routes to the consolidated pump [action] dispatcher.
// Tests and legacy imports reference individual files; this forwards them.
import dispatcher from './[action].js';
export default function handler(req, res) {
	if (!req.query) req.query = {};
	req.query.action = 'by-agent';
	return dispatcher(req, res);
}
