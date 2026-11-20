import { defineConfig } from 'vite';

// three.js plus the meshopt decoder is one ~690 kB chunk (~173 kB gzipped),
// which is the whole app: raise the warning line above it instead of splitting.
export default defineConfig({
	build: { chunkSizeWarningLimit: 800 },
});
