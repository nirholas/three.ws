// Build small, valid PDFs in memory for tests that need a real file for pdf.js
// to parse, render and read a text layer from: positioned Helvetica text and
// ruled lines, one content stream per page, a correct xref table.
//
// Coordinates are PDF points on a US Letter page (612 x 792), origin
// bottom-left, as in the PDF spec.

const PAGE_W = 612;
const PAGE_H = 792;

const escText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * @param {{ texts?: { x: number, y: number, text: string, size?: number }[], lines?: { x0: number, y0: number, x1: number, y1: number }[] }[]} pages
 * @param {{ encrypt?: boolean }} [opts] `encrypt` adds an /Encrypt entry so
 *   pdf.js asks for a password (the file is otherwise unchanged).
 * @returns {Buffer}
 */
export function buildPdf(pages, { encrypt = false } = {}) {
	const objects = [];
	const add = (body) => {
		objects.push(body);
		return objects.length;
	};
	const catalog = add(null);
	const pagesObj = add(null);
	const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
	const kids = [];
	for (const page of pages) {
		const ops = [];
		for (const l of page.lines || []) ops.push(`0.5 w ${l.x0} ${l.y0} m ${l.x1} ${l.y1} l S`);
		for (const t of page.texts || []) ops.push(`BT /F1 ${t.size || 10} Tf ${t.x} ${t.y} Td (${escText(t.text)}) Tj ET`);
		const stream = ops.join('\n');
		const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
		kids.push(
			add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`),
		);
	}
	objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
	objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
	let encryptRef = null;
	if (encrypt) {
		const o = '<' + 'a'.repeat(64) + '>';
		encryptRef = add(`<< /Filter /Standard /V 1 /R 2 /O ${o} /U ${o} /P -4 >>`);
	}

	let out = '%PDF-1.4\n';
	const offsets = [];
	objects.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out, 'latin1'));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out, 'latin1');
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
	const id = '<00112233445566778899aabbccddeeff>';
	out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encryptRef ? ` /Encrypt ${encryptRef} 0 R /ID [${id} ${id}]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

export const PAGE_SIZE = { width: PAGE_W, height: PAGE_H };
