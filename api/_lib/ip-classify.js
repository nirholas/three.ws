// Address classification shared by every SSRF guard (api/_lib/ssrf.js,
// api/_lib/ssrf-guard.js and the callers that pre-check literal hosts).
// Dependency-free on purpose so any guard can import it without pulling in a
// network stack, and so a test that mocks one guard module cannot silently
// change how another guard classifies an address.

export function isPrivateIPv4(ip) {
	const p = ip.split('.').map(Number);
	if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
	if (p[0] === 10) return true;
	if (p[0] === 127) return true;
	if (p[0] === 0) return true;
	if (p[0] === 169 && p[1] === 254) return true; // link-local, cloud metadata
	if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64.0.0/10 (incl. Alibaba metadata 100.100.100.200)
	if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
	if (p[0] === 192 && p[1] === 168) return true;
	if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true; // IETF
	if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true; // docs
	if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true; // benchmark
	if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true; // docs
	if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true; // docs
	if (p[0] >= 224) return true; // multicast + reserved
	return false;
}

// Expand any textual IPv6 form (compressed `::`, embedded dotted IPv4 tail,
// zone id, brackets) to its eight 16-bit groups. Returns null when the text is
// not a valid IPv6 address. Prefix checks run on the numeric groups, never on
// the string, because the same address has many spellings: `::ffff:127.0.0.1`
// and `::ffff:7f00:1` are one address, and a string-prefix test that only knows
// the dotted spelling lets the hex one through to loopback.
export function parseIPv6Groups(ip) {
	let s = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '');
	const zone = s.indexOf('%');
	if (zone !== -1) s = s.slice(0, zone);
	let tail = [];
	const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
	if (dotted) {
		const octets = dotted[2].split('.').map(Number);
		if (octets.some((n) => n > 255)) return null;
		tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
		s = dotted[1].endsWith('::') ? dotted[1] : dotted[1].slice(0, -1);
	}
	const halves = s.split('::');
	if (halves.length > 2) return null;
	const toGroups = (part) => (part ? part.split(':') : []);
	const head = toGroups(halves[0]);
	const rest = halves.length === 2 ? toGroups(halves[1]) : [];
	const words = [...head, ...rest];
	if (words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null;
	const explicit = words.length + tail.length;
	if (halves.length === 1 && explicit !== 8) return null;
	if (halves.length === 2 && explicit > 7) return null;
	const fill = new Array(8 - explicit).fill(0);
	const groups = [
		...head.map((w) => parseInt(w, 16)),
		...(halves.length === 2 ? fill : []),
		...rest.map((w) => parseInt(w, 16)),
		...tail,
	];
	return groups.length === 8 ? groups : null;
}

function embeddedIPv4(hi, lo) {
	return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

export function isPrivateIPv6(ip) {
	const g = parseIPv6Groups(ip);
	if (!g) return true; // unparseable: refuse rather than guess
	const zeroPrefix = (n) => g.slice(0, n).every((w) => w === 0);
	// ::/96 covers ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d form.
	if (zeroPrefix(6)) {
		if (g[6] === 0 && g[7] <= 1) return true;
		return isPrivateIPv4(embeddedIPv4(g[6], g[7]));
	}
	// ::ffff:0:0/96 IPv4-mapped, any spelling (::ffff:7f00:1 is 127.0.0.1).
	if (zeroPrefix(5) && g[5] === 0xffff) return isPrivateIPv4(embeddedIPv4(g[6], g[7]));
	// ::ffff:0:0:0/96 IPv4-translated (RFC 2765).
	if (zeroPrefix(4) && g[4] === 0xffff && g[5] === 0) {
		return isPrivateIPv4(embeddedIPv4(g[6], g[7]));
	}
	// 64:ff9b::/96 well-known NAT64 prefix: the IPv4 tail is what a NAT64
	// gateway actually dials, so it gets the IPv4 verdict.
	if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((w) => w === 0)) {
		return isPrivateIPv4(embeddedIPv4(g[6], g[7]));
	}
	if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
	// 2002::/16 6to4 carries an IPv4 address in groups 1-2.
	if (g[0] === 0x2002) return isPrivateIPv4(embeddedIPv4(g[1], g[2]));
	if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo (obfuscated IPv4 inside)
	if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // 2001:db8::/32 documentation
	if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
	if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
	if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA (incl. fd00:ec2::254 IMDS)
	if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
	return false;
}
