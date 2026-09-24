// Document content types, shared by web_fetch and parse_document.
//
// web_fetch reads HTML and text. A binary document (PDF, Office, OpenDocument,
// RTF) decoded as UTF-8 is noise, so web_fetch uses this check to point the
// caller at parse_document instead of returning half-read bytes.

const DOCUMENT_TYPES = new Set([
	'application/pdf',
	'application/msword',
	'application/vnd.ms-excel',
	'application/vnd.ms-powerpoint',
	'application/rtf',
	'text/rtf',
]);

const DOCUMENT_PREFIXES = [
	'application/vnd.openxmlformats-officedocument.',
	'application/vnd.oasis.opendocument.',
];

/** True when a Content-Type header names a binary document rather than a page. */
export function isDocumentContentType(contentType) {
	const type = String(contentType || '').split(';')[0].trim().toLowerCase();
	if (!type) return false;
	return DOCUMENT_TYPES.has(type) || DOCUMENT_PREFIXES.some((p) => type.startsWith(p));
}
