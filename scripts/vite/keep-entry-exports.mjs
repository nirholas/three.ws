// Vite builds an app with `preserveEntrySignatures: false`, which strips every
// export from an entry chunk. Entries that are meant to be imported by other
// origins (the /herald.js CDN build) need their exports kept, so each one is
// emitted from here with a strict signature while every other entry is left
// alone. Each entry is written to the dist root as <name>.js, unhashed.
//
//   Usage: pass a map of output name to absolute entry path, e.g. the herald embed.

/**
 * @param {Record<string, string>} entries chunk name -> absolute source path
 * @returns {import('vite').Plugin}
 */
export function keepEntryExports(entries) {
	return {
		name: 'three-ws:keep-entry-exports',
		apply: 'build',
		buildStart() {
			for (const [name, id] of Object.entries(entries)) {
				this.emitFile({ type: 'chunk', name, id, fileName: `${name}.js`, preserveSignature: 'strict' });
			}
		},
	};
}
