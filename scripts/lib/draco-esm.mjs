// The Draco decoder wrapper three ships is a classic script that defines a
// global `DracoDecoderModule` and ends with a UMD export probe. Evaluating it
// with `new Function` needs 'unsafe-eval' in the page CSP; wrapping it as an ES
// module needs nothing, and a module worker can import it where `importScripts`
// does not exist. The UMD probe is cut so a CommonJS-shaped host (bundlers,
// test runners) cannot try to assign to a read-only module namespace.
const UMD_TAIL = /"object"===typeof exports&&"object"===typeof module\?[\s\S]*?;?\s*$/;

export function dracoEsmSource(wrapperSource) {
	return `${wrapperSource.replace(UMD_TAIL, '')}\nexport default DracoDecoderModule;\n`;
}
