import { cors, json, method, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	return json(res, 200, {
		apiKey: env.RIDER_FIREBASE_API_KEY ?? null,
		authDomain: env.RIDER_FIREBASE_AUTH_DOMAIN ?? null,
		databaseURL: env.RIDER_FIREBASE_DATABASE_URL ?? null,
		projectId: env.RIDER_FIREBASE_PROJECT_ID ?? null,
		storageBucket: env.RIDER_FIREBASE_STORAGE_BUCKET ?? null,
		messagingSenderId: env.RIDER_FIREBASE_MESSAGING_SENDER_ID ?? null,
	});
});
