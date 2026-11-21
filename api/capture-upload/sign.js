// POST /api/capture-upload/sign (contract C4, api/_lib/capture-upload.js)
import { captureUploadHandler, signParts } from '../_lib/capture-upload.js';

export default captureUploadHandler('upload a capture file', signParts);
