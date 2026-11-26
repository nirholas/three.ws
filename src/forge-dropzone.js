// /forge: paste or drop reference photos (or an image link) anywhere on the
// page. The behavior lives in src/shared/forge-dropzone.js, shared with Forge
// Studio; /forge takes up to six views.

import { installForgeDropzone } from './shared/forge-dropzone.js';

installForgeDropzone({ maxViews: 6 });
