// Forge Studio: paste or drop reference photos (or an image link) anywhere on
// the page. The behavior lives in src/shared/forge-dropzone.js, shared with
// /forge; Studio takes up to four views.

import { installForgeDropzone } from '../shared/forge-dropzone.js';

installForgeDropzone({ maxViews: 4 });
