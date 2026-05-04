const SNS_API = 'https://sns-api.bonfida.com';

async function snsFetch(path) {
	const r = await fetch(`${SNS_API}${path}`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(5000),
	});
	if (!r.ok) throw new Error(`sns api ${r.status}`);
	return r.json();
}

function stripSol(name) {
	return name.endsWith('.sol') ? name.slice(0, -4) : name;
}

export async function resolveSnsName(name) {
	try {
		const domain = stripSol(name);
		const body = await snsFetch(`/v2/resolve/${encodeURIComponent(domain)}`);
		return body?.owner || body?.data?.owner || null;
	} catch {
		return null;
	}
}

export async function reverseLookupAddress(addr) {
	try {
		const body = await snsFetch(`/v2/user/fav-domains/${encodeURIComponent(addr)}`);
		const domain = body?.[addr] || body?.data?.[addr] || null;
		if (!domain) return null;
		return domain.endsWith('.sol') ? domain : `${domain}.sol`;
	} catch {
		return null;
	}
}
