// POST /api/capture-upload/complete (contract C4, api/_lib/capture-upload.js)
import { captureUploadHandler, completeUpload } from '../_lib/capture-upload.js';

export default captureUploadHandler('finish a capture upload', completeUpload);
