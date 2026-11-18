import base from './vite.config.js';
export default { ...base, server: { ...(base.server || {}), watch: null, hmr: false } };
