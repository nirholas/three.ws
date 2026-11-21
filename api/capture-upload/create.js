// POST /api/capture-upload/create (contract C4, api/_lib/capture-upload.js)
import { captureUploadHandler, createUpload } from '../_lib/capture-upload.js';

export default captureUploadHandler('start a capture upload', createUpload);
