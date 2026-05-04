
import { cors, method } from '../_lib/http.js';
import { connectPumpFunFeed } from '../_lib/pumpfun-ws-feed.js';

export default async function handleTradesStream(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		'X-Accel-Buffering': 'no',
	});

	const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

	const { close } = await connectPumpFunFeed({
		onTrade: (trade) => {
			if (trade.is_buy) {
				send({ type: 'trade', ...trade });
			}
		},
		onError: (err) => send({ type: 'error', message: err.message }),
		onClose: (code) => send({ type: 'close', code }),
	});

	req.on('close', close);
}
