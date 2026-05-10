// Server-side re-export of the isomorphic glTF inspector. The canonical
// implementation lives in src/gltf-inspect.js so the browser /validation page
// and Vercel serverless functions share one code path.

export { inspectModel, suggestOptimizations } from '../../src/gltf-inspect.js';
