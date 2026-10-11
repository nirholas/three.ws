import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// =============================================================================
// Types
// =============================================================================

interface PhotoItem {
  id: string;
  data: string; // base64 data URL
  caption: string;
  addedAt: string;
}

type GalleryStyle = 'grid' | 'slideshow' | 'polaroid';

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'hq-gallery-photos';
const MAX_PHOTOS = 20;
const MAX_WIDTH = 800;
const QUALITY = 0.7;

// =============================================================================
// Helpers
// =============================================================================

function loadPhotos(): PhotoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PhotoItem[]) : [];
  } catch {
    return [];
  }
}

function savePhotos(photos: PhotoItem[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(photos));
    return true;
  } catch {
    return false;
  }
}

function getStorageSize(photos: PhotoItem[]): string {
  const bytes = new Blob([JSON.stringify(photos)]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const img = new Image();
      img.addEventListener('load', () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > MAX_WIDTH) {
          height = (height * MAX_WIDTH) / width;
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas unavailable')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      });
      img.addEventListener('error', () => reject(new Error('Image load failed')));
      img.src = reader.result as string;
    });
    reader.addEventListener('error', () => reject(new Error('File read failed')));
    reader.readAsDataURL(file);
  });
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10_000;
  return x - Math.floor(x);
}

// =============================================================================
// PhotoGalleryPanel
// =============================================================================

export class PhotoGalleryPanel extends Panel {
  private photos: PhotoItem[] = [];
  private galleryStyle: GalleryStyle = 'grid';
  private slideshowIndex = 0;
  private slideshowPlaying = true;
  private slideshowTimer: ReturnType<typeof setInterval> | null = null;
  private slideshowInterval = 5000;
  private modalOpen = false;
  private modalIndex = 0;
  private modalOverlay: HTMLElement | null = null;

  constructor() {
    super({ id: 'photo-gallery', title: 'Photo Gallery', showCount: true });
    this.photos = loadPhotos();
    this.render();
  }

  public destroy(): void {
    super.destroy();
    this.stopSlideshow();
    this.closeModal();
  }

  // ---- Persistence ----

  private persist(): void {
    const ok = savePhotos(this.photos);
    if (!ok) {
      console.warn('[PhotoGallery] Storage quota exceeded');
    }
    this.setCount(this.photos.length);
  }

  // ---- Photo operations ----

  private async addPhoto(file: File): Promise<void> {
    if (this.photos.length >= MAX_PHOTOS) return;
    if (!file.type.startsWith('image/')) return;
    try {
      const data = await compressImage(file);
      const photo: PhotoItem = {
        id: crypto.randomUUID(),
        data,
        caption: '',
        addedAt: new Date().toISOString(),
      };
      this.photos.push(photo);
      this.persist();
      this.render();
    } catch {
      // ignore bad images
    }
  }

  private deletePhoto(id: string): void {
    this.photos = this.photos.filter(p => p.id !== id);
    this.persist();
    if (this.modalOpen) this.closeModal();
    this.render();
  }

  private updateCaption(id: string, caption: string): void {
    const photo = this.photos.find(p => p.id === id);
    if (photo) {
      photo.caption = caption;
      this.persist();
    }
  }

  // ---- Slideshow ----

  private startSlideshow(): void {
    this.stopSlideshow();
    if (this.photos.length < 2) return;
    this.slideshowPlaying = true;
    this.slideshowTimer = setInterval(() => {
      this.slideshowIndex = (this.slideshowIndex + 1) % this.photos.length;
      this.render();
    }, this.slideshowInterval);
  }

  private stopSlideshow(): void {
    this.slideshowPlaying = false;
    if (this.slideshowTimer) {
      clearInterval(this.slideshowTimer);
      this.slideshowTimer = null;
    }
  }

  // ---- Modal ----

  private openModal(idx: number): void {
    this.modalIndex = idx;
    this.modalOpen = true;
    this.renderModal();
  }

  private closeModal(): void {
    this.modalOpen = false;
    if (this.modalOverlay) {
      this.modalOverlay.remove();
      this.modalOverlay = null;
    }
  }

  private renderModal(): void {
    if (this.modalOverlay) this.modalOverlay.remove();
    const photo = this.photos[this.modalIndex];
    if (!photo) return;

    const overlay = document.createElement('div');
    overlay.className = 'pg-modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeModal();
    });

    overlay.innerHTML = `
      <div class="pg-modal-content">
        <img class="pg-modal-img" src="${photo.data}" alt="${escapeHtml(photo.caption || 'Photo')}" />
        ${this.photos.length > 1 ? `
          <button class="pg-modal-nav pg-modal-prev" data-action="prev">&#8249;</button>
          <button class="pg-modal-nav pg-modal-next" data-action="next">&#8250;</button>
        ` : ''}
        <div class="pg-modal-footer">
          <input class="pg-modal-caption" type="text" placeholder="Add caption..." value="${escapeHtml(photo.caption)}" data-id="${photo.id}" />
          <button class="pg-modal-delete" data-id="${photo.id}">✕ Delete</button>
          <span class="pg-modal-counter">${this.modalIndex + 1} / ${this.photos.length}</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.modalOverlay = overlay;

    // Bind events
    const prevBtn = overlay.querySelector('[data-action="prev"]');
    const nextBtn = overlay.querySelector('[data-action="next"]');
    const captionInput = overlay.querySelector('.pg-modal-caption') as HTMLInputElement | null;
    const deleteBtn = overlay.querySelector('.pg-modal-delete') as HTMLElement | null;

    prevBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.modalIndex = (this.modalIndex - 1 + this.photos.length) % this.photos.length;
      this.renderModal();
    });
    nextBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.modalIndex = (this.modalIndex + 1) % this.photos.length;
      this.renderModal();
    });
    captionInput?.addEventListener('change', () => {
      if (captionInput) {
        this.updateCaption(photo.id, captionInput.value);
      }
    });
    deleteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deletePhoto(photo.id);
    });
  }

  // ---- Main render ----

  private render(): void {
    this.setCount(this.photos.length);

    const styleOptions = ['grid', 'slideshow', 'polaroid'] as const;
    const tabs = styleOptions.map(s =>
      `<button class="pg-style-btn${this.galleryStyle === s ? ' active' : ''}" data-style="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</button>`
    ).join('');

    let gallery = '';
    if (this.photos.length === 0) {
      gallery = `
        <div class="pg-empty">
          <div class="pg-empty-shapes">
            <div class="pg-shape" style="width:50px;height:60px"></div>
            <div class="pg-shape" style="width:55px;height:70px"></div>
            <div class="pg-shape" style="width:45px;height:55px"></div>
          </div>
          <div style="font-weight:600;font-size:13px">No photos yet</div>
          <div style="font-size:11px;color:var(--text-dim)">Upload images to create your gallery</div>
        </div>
      `;
    } else if (this.galleryStyle === 'grid') {
      gallery = this.renderGrid();
    } else if (this.galleryStyle === 'slideshow') {
      gallery = this.renderSlideshow();
    } else {
      gallery = this.renderPolaroid();
    }

    const html = `
      <div class="pg-container">
        <div class="pg-style-tabs">${tabs}</div>
        <div class="pg-upload-area" id="pg-drop-zone">
          <span class="pg-upload-icon">⬆</span>
          <span>Drop image or <label class="pg-upload-label"><input type="file" accept="image/*" class="pg-file-input" style="display:none" />click to upload</label></span>
          <span class="pg-upload-count">(${this.photos.length}/${MAX_PHOTOS})</span>
        </div>
        <div class="pg-storage-info">${this.photos.length}/${MAX_PHOTOS} photos · ${getStorageSize(this.photos)} used</div>
        <div class="pg-gallery">${gallery}</div>
      </div>
    `;

    this.setContent(html);
    this.bindEvents();
  }

  private renderGrid(): string {
    return `<div class="pg-grid">${this.photos.map((photo, idx) => `
      <div class="pg-grid-item" data-idx="${idx}">
        <img src="${photo.data}" alt="${escapeHtml(photo.caption || 'Photo')}" />
        <button class="pg-delete-btn" data-delete="${photo.id}" title="Delete">✕</button>
        ${photo.caption ? `<div class="pg-grid-caption">${escapeHtml(photo.caption)}</div>` : ''}
      </div>
    `).join('')}</div>`;
  }

  private renderSlideshow(): string {
    if (this.slideshowIndex >= this.photos.length) this.slideshowIndex = 0;
    const photo = this.photos[this.slideshowIndex];
    if (!photo) return '';
    return `
      <div class="pg-slideshow">
        <div class="pg-slide-container">
          <img class="pg-slide-img" src="${photo.data}" alt="${escapeHtml(photo.caption || 'Photo')}" data-idx="${this.slideshowIndex}" />
          <button class="pg-slide-nav pg-slide-prev" data-action="slide-prev">&#8249;</button>
          <button class="pg-slide-nav pg-slide-next" data-action="slide-next">&#8250;</button>
        </div>
        <div class="pg-slide-controls">
          <button class="pg-slide-play" data-action="toggle-play">${this.slideshowPlaying ? '⏸' : '▶'}</button>
          <div class="pg-slide-intervals">
            ${[3000, 5000, 10000, 15000].map(ms =>
              `<button class="pg-interval-btn${this.slideshowInterval === ms ? ' active' : ''}" data-interval="${ms}">${ms / 1000}s</button>`
            ).join('')}
          </div>
          <button class="pg-delete-btn" data-delete="${photo.id}" title="Delete">✕</button>
        </div>
        ${photo.caption ? `<div class="pg-slide-caption">${escapeHtml(photo.caption)}</div>` : ''}
        <div class="pg-slide-counter">${this.slideshowIndex + 1} / ${this.photos.length}</div>
      </div>
    `;
  }

  private renderPolaroid(): string {
    return `<div class="pg-polaroid-stack">${this.photos.map((photo, idx) => {
      const rotation = seededRandom(idx * 13 + 7) * 10 - 5;
      const offsetX = 20 + seededRandom(idx * 17 + 3) * 80;
      const offsetY = 10 + seededRandom(idx * 23 + 11) * 60;
      return `
        <div class="pg-polaroid-item" style="left:${offsetX}px;top:${offsetY}px;transform:rotate(${rotation.toFixed(1)}deg);z-index:${idx}" data-idx="${idx}">
          <div class="pg-polaroid-img-wrap">
            <img src="${photo.data}" alt="${escapeHtml(photo.caption || 'Photo')}" />
          </div>
          <div class="pg-polaroid-caption">${escapeHtml(photo.caption || '\u00A0')}</div>
          <button class="pg-delete-btn" data-delete="${photo.id}" title="Delete">✕</button>
        </div>
      `;
    }).join('')}</div>`;
  }

  private bindEvents(): void {
    // Style tabs
    this.content.querySelectorAll('.pg-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const style = (btn as HTMLElement).dataset.style as GalleryStyle;
        this.galleryStyle = style;
        this.stopSlideshow();
        if (style === 'slideshow') this.startSlideshow();
        this.render();
      });
    });

    // File input
    const fileInput = this.content.querySelector('.pg-file-input') as HTMLInputElement | null;
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.addPhoto(file);
    });

    // Drag and drop
    const dropZone = this.content.querySelector('#pg-drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        (e as DragEvent).preventDefault();
        (dropZone as HTMLElement).classList.add('pg-drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        (dropZone as HTMLElement).classList.remove('pg-drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        (e as DragEvent).preventDefault();
        (dropZone as HTMLElement).classList.remove('pg-drag-over');
        const file = (e as DragEvent).dataTransfer?.files[0];
        if (file) void this.addPhoto(file);
      });
    }

    // Grid click & delete
    this.content.querySelectorAll('.pg-grid-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.pg-delete-btn')) return;
        const idx = parseInt((item as HTMLElement).dataset.idx || '0', 10);
        this.openModal(idx);
      });
    });

    // Delete buttons
    this.content.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.delete!;
        this.deletePhoto(id);
      });
    });

    // Slideshow controls
    this.content.querySelector('[data-action="slide-prev"]')?.addEventListener('click', () => {
      this.slideshowIndex = (this.slideshowIndex - 1 + this.photos.length) % this.photos.length;
      this.render();
    });
    this.content.querySelector('[data-action="slide-next"]')?.addEventListener('click', () => {
      this.slideshowIndex = (this.slideshowIndex + 1) % this.photos.length;
      this.render();
    });
    this.content.querySelector('[data-action="toggle-play"]')?.addEventListener('click', () => {
      if (this.slideshowPlaying) this.stopSlideshow();
      else this.startSlideshow();
      this.render();
    });
    this.content.querySelectorAll('[data-interval]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.slideshowInterval = parseInt((btn as HTMLElement).dataset.interval || '5000', 10);
        if (this.slideshowPlaying) this.startSlideshow();
        this.render();
      });
    });

    // Polaroid click
    this.content.querySelectorAll('.pg-polaroid-item').forEach(item => {
      item.addEventListener('dblclick', () => {
        const idx = parseInt((item as HTMLElement).dataset.idx || '0', 10);
        this.openModal(idx);
      });
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.pg-delete-btn')) return;
        // Bring to front
        const allItems = this.content.querySelectorAll('.pg-polaroid-item');
        allItems.forEach((el, i) => (el as HTMLElement).style.zIndex = String(i));
        (item as HTMLElement).style.zIndex = String(allItems.length + 1);
      });
    });

    // Slideshow auto-start
    if (this.galleryStyle === 'slideshow' && this.slideshowPlaying && this.photos.length >= 2) {
      this.startSlideshow();
    }

    // Click on slideshow image to open modal
    this.content.querySelector('.pg-slide-img')?.addEventListener('click', () => {
      this.openModal(this.slideshowIndex);
    });
  }
}
