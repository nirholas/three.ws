import './camera-capture.css';

// Guard SSR environments — module must be importable without a DOM.
const _hasNav = typeof navigator !== 'undefined';

export class CameraCapture {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.container
     * @param {(blob: Blob, meta: {width:number, height:number, mimeType:string}) => void} opts.onCapture
     * @param {() => void} [opts.onCancel]
     * @param {number} [opts.aspect]
     */
    constructor({ container, onCapture, onCancel, aspect = 1 }) {
        this._container = container;
        this._onCapture = onCapture;
        this._onCancel = onCancel ?? (() => {});
        this._aspect = aspect;

        this._stream = null;
        this._facingMode = 'user';
        this._root = null;
        this._video = null;
        this._canvas = null;
        this._snapshot = null; // current preview blob URL
        this._stopped = false;
        this._abortCtrl = new AbortController();
    }

    async start() {
        if (this._stopped) return;

        this._root = document.createElement('div');
        this._root.className = 'camera-capture-root';
        this._container.appendChild(this._root);

        if (!_hasNav || !navigator.mediaDevices?.getUserMedia) {
            this._renderFallback('Camera not available in this browser.');
            return;
        }

        try {
            await this._startStream();
            this._renderLive();
        } catch (err) {
            const msg =
                err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
                    ? 'Camera permission denied.'
                    : 'Could not access camera.';
            this._renderFallback(msg);
        }
    }

    stop() {
        if (this._stopped) return;
        this._stopped = true;
        this._abortCtrl.abort();
        this._releaseStream();
        if (this._snapshot) {
            URL.revokeObjectURL(this._snapshot);
            this._snapshot = null;
        }
        if (this._root && this._root.parentNode) {
            this._root.parentNode.removeChild(this._root);
        }
        this._root = null;
    }

    // ── private ────────────────────────────────────────────────────────────

    async _startStream() {
        this._releaseStream();
        this._stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: this._facingMode,
                width: { ideal: 1280 },
                height: { ideal: 1280 },
            },
        });
    }

    _releaseStream() {
        if (this._stream) {
            for (const track of this._stream.getTracks()) track.stop();
            this._stream = null;
        }
        if (this._video) {
            this._video.srcObject = null;
        }
    }

    _listen(el, event, handler) {
        el.addEventListener(event, handler, { signal: this._abortCtrl.signal });
    }

    // ── live view ──────────────────────────────────────────────────────────

    _renderLive() {
        this._root.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'cc-preview-wrap';

        const video = document.createElement('video');
        video.className = 'cc-video';
        video.autoplay = true;
        video.muted = true;
        video.setAttribute('playsinline', ''); // iOS Safari requires this attribute
        video.setAttribute('webkit-playsinline', ''); // older Safari compat
        video.srcObject = this._stream;
        this._video = video;

        wrap.appendChild(video);
        this._root.appendChild(wrap);

        const controls = document.createElement('div');
        controls.className = 'cc-controls';

        // Switch-camera button — only useful on mobile (multiple cameras)
        const btnSwitch = document.createElement('button');
        btnSwitch.className = 'cc-btn-switch';
        btnSwitch.title = 'Switch camera';
        btnSwitch.textContent = '⇄';
        this._listen(btnSwitch, 'click', () => this._switchCamera());

        const btnCapture = document.createElement('button');
        btnCapture.className = 'cc-btn-capture';
        btnCapture.setAttribute('aria-label', 'Capture photo');
        this._listen(btnCapture, 'click', () => this._capture());

        // Spacer so layout is symmetric around the large button
        const spacer = document.createElement('div');
        spacer.style.width = '44px';

        controls.appendChild(btnSwitch);
        controls.appendChild(btnCapture);
        controls.appendChild(spacer);
        this._root.appendChild(controls);

        const uploadLink = document.createElement('button');
        uploadLink.className = 'cc-link-upload';
        uploadLink.textContent = 'Use upload instead';
        this._listen(uploadLink, 'click', () => {
            this._releaseStream();
            this._renderFallback(null);
        });
        this._root.appendChild(uploadLink);
    }

    async _switchCamera() {
        this._facingMode = this._facingMode === 'user' ? 'environment' : 'user';
        try {
            await this._startStream();
            if (this._video) this._video.srcObject = this._stream;
        } catch (_) {
            // revert if the back camera isn't available
            this._facingMode = this._facingMode === 'user' ? 'environment' : 'user';
        }
    }

    _capture() {
        if (!this._video || !this._stream) return;

        const v = this._video;
        const side = Math.min(v.videoWidth || 1280, v.videoHeight || 1280);
        const ox = ((v.videoWidth || side) - side) / 2;
        const oy = ((v.videoHeight || side) - side) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext('2d');

        // Mirror to match the CSS transform on the live preview
        ctx.save();
        ctx.translate(side, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(v, ox, oy, side, side, 0, 0, side, side);
        ctx.restore();

        this._canvas = canvas;

        canvas.toBlob(
            (blob) => {
                if (!blob || this._stopped) return;
                this._renderPreview(blob, side, side);
            },
            'image/jpeg',
            0.92,
        );
    }

    // ── preview (post-capture) ─────────────────────────────────────────────

    _renderPreview(blob, width, height) {
        if (this._snapshot) URL.revokeObjectURL(this._snapshot);
        this._snapshot = URL.createObjectURL(blob);

        this._root.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'cc-preview-wrap';

        const img = document.createElement('img');
        img.className = 'cc-snapshot';
        img.src = this._snapshot;
        img.alt = 'Captured photo preview';
        wrap.appendChild(img);
        this._root.appendChild(wrap);

        const controls = document.createElement('div');
        controls.className = 'cc-controls';

        const btnRetake = document.createElement('button');
        btnRetake.className = 'cc-btn-retake';
        btnRetake.textContent = 'Retake';
        this._listen(btnRetake, 'click', async () => {
            try {
                await this._startStream();
                this._renderLive();
            } catch (err) {
                this._renderFallback('Could not restart camera.');
            }
        });

        const btnUse = document.createElement('button');
        btnUse.className = 'cc-btn-use';
        btnUse.textContent = 'Use this photo';
        this._listen(btnUse, 'click', () => {
            this._releaseStream();
            this._onCapture(blob, { width, height, mimeType: 'image/jpeg' });
        });

        controls.appendChild(btnRetake);
        controls.appendChild(btnUse);
        this._root.appendChild(controls);
    }

    // ── file-upload fallback ───────────────────────────────────────────────

    _renderFallback(reason) {
        this._root.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'cc-fallback';

        if (reason) {
            const err = document.createElement('p');
            err.className = 'cc-error';
            err.textContent = reason;
            wrap.appendChild(err);
        }

        const p = document.createElement('p');
        p.textContent = 'Choose a photo from your device to continue.';
        wrap.appendChild(p);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'user');
        input.className = 'cc-hidden-input';

        const btnPick = document.createElement('button');
        btnPick.className = 'cc-btn-file-pick';
        btnPick.textContent = 'Choose photo';
        this._listen(btnPick, 'click', () => input.click());

        this._listen(input, 'change', () => {
            const file = input.files?.[0];
            if (!file) return;
            this._handleFileBlob(file);
        });

        wrap.appendChild(btnPick);
        wrap.appendChild(input);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cc-link-upload';
        cancelBtn.textContent = 'Cancel';
        this._listen(cancelBtn, 'click', () => {
            this.stop();
            this._onCancel();
        });
        wrap.appendChild(cancelBtn);

        this._root.appendChild(wrap);
    }

    _handleFileBlob(file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const ox = (img.naturalWidth - side) / 2;
            const oy = (img.naturalHeight - side) / 2;

            const canvas = document.createElement('canvas');
            canvas.width = side;
            canvas.height = side;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, ox, oy, side, side, 0, 0, side, side);
            URL.revokeObjectURL(url);

            canvas.toBlob(
                (blob) => {
                    if (!blob || this._stopped) return;
                    this._onCapture(blob, {
                        width: side,
                        height: side,
                        mimeType: 'image/jpeg',
                    });
                },
                'image/jpeg',
                0.92,
            );
        };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
    }
}
