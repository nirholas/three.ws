// POST /api/capture-upload/parts: C4 extension, lists stored parts so a resumed upload re-signs only the missing ones
import { captureUploadHandler, listUploadedParts } from '../_lib/capture-upload.js';

export default captureUploadHandler('resume a capture upload', listUploadedParts);
