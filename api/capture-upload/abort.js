// POST /api/capture-upload/abort (contract C4, api/_lib/capture-upload.js)
import { captureUploadHandler, abortUpload } from '../_lib/capture-upload.js';

export default captureUploadHandler('cancel a capture upload', abortUpload);
