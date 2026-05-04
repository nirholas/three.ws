// src/pumpfun-client.js

class PumpFunClient extends EventTarget {
	constructor() {
		super();
		this.RPC_ENDPOINTS = [
			{ url: 'wss://pumpportal.fun/api/data', protocol: 'pumpportal', label: 'PumpPortal' },
			{ url: 'wss://pump-fun-websocket-production.up.railway.app/ws', protocol: 'relay', label: 'Relay Server' },
		];
		this.rpcIndex = 0;
		this.ws = null;
		this.connect();
	}

	connect() {
		const ep = this.RPC_ENDPOINTS[this.rpcIndex % this.RPC_ENDPOINTS.length];
		this.rpcIndex++;
		this.ws = new WebSocket(ep.url);

		this.ws.onopen = () => {
			if (ep.protocol === 'pumpportal') {
				this.ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
			}
			this.dispatchEvent(new CustomEvent('open'));
		};

		this.ws.onmessage = (evt) => {
			let msg;
			try { msg = JSON.parse(evt.data); } catch { return; }

			let info = null;

			if (ep.protocol === 'relay') {
				if (msg.type === 'token-launch' || msg.mint) {
					info = {
						mint: msg.mint || 'unknown',
						name: msg.name || null,
						symbol: msg.symbol || null,
						imageUrl: msg.imageUri || null,
						marketCapSol: msg.marketCapSol || 0,
					};
				}
			} else if (ep.protocol === 'pumpportal') {
				if (msg && msg.mint) {
					const vSol = msg.vSolInBondingCurve || 0;
					const vTok = msg.vTokensInBondingCurve || 0;
					const supply = msg.tokenTotalSupply || (vTok > 0 ? 1e15 : 0);
					let mcap = msg.marketCapSol || 0;
					if (!mcap && vTok > 0 && vSol > 0) {
						mcap = (vSol / vTok) * supply / 1e9;
					}
					info = {
						mint: msg.mint,
						name: msg.name || null,
						symbol: msg.symbol || null,
						marketCapSol: mcap,
						imageUrl: null,
					};
				}
			}
			
			if (info) {
				this.dispatchEvent(new CustomEvent('token', { detail: info }));
			}
		};

		this.ws.onclose = () => {
			this.dispatchEvent(new CustomEvent('close'));
			setTimeout(() => this.connect(), 1000);
		};

		this.ws.onerror = (err) => {
			this.dispatchEvent(new CustomEvent('error', { detail: err }));
		}
	}
}

const pumpFunClient = new PumpFunClient();

export default pumpFunClient;
