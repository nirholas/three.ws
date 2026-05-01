/* global AFRAME */
// Lists 3D avatars created on three.ws and swaps the gltf-model on
// #agentCompanion when one is picked. Sources: live /api/explore feed,
// ?agent=<id> URL param, or postMessage from a parent host frame.
//
// postMessage protocol (parent → rider iframe):
//   { type: 'rider:setAgent', agentId: 'cz' }
//   { type: 'rider:setAgent', url: 'https://.../foo.glb', name: 'Foo' }

// Always call three.ws directly — explore API allows all origins.
const EXPLORE_URL = 'https://three.ws/api/explore';
const FALLBACK_AGENTS = [
  { id: 'cz', name: 'CZ', url: 'https://raw.githubusercontent.com/overstepping/-/main/cz.glb' }
];

AFRAME.registerSystem('agent-picker', {
  init: function () {
    this.agents = FALLBACK_AGENTS.slice();
    this.currentId = null;
    this.companionEl = null;
    this.searchQuery = '';

    const ready = () => {
      this.companionEl = document.querySelector('#agentCompanion');
      if (!this.companionEl) return;
      this.buildOverlay();
      this.applyInitialSelection();
      this.wireSceneEvents();
      this.wirePostMessage();
      this.fetchPublicAvatars();
    };

    if (this.sceneEl.hasLoaded) { ready(); }
    else { this.sceneEl.addEventListener('loaded', ready); }
  },

  fetchPublicAvatars: function (query = '') {
    const url = new URL(EXPLORE_URL);
    url.searchParams.set('only3d', '1');
    url.searchParams.set('limit', '40');
    if (query) url.searchParams.set('q', query);
    fetch(url.toString())
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !Array.isArray(data.items)) return;
        const fetched = data.items
          .filter(it => it.glbUrl)
          .map(it => ({
            id: `${it.kind}-${it.agentId || it.name}-${it.sortDate}`,
            name: it.name || 'Untitled',
            url: rewriteGlbUrl(it.glbUrl),
            owner: it.ownerShort || ''
          }));
        this.agents = FALLBACK_AGENTS.concat(fetched);
        this.renderList();
      })
      .catch(() => {});
  },

  buildOverlay: function () {
    if (document.getElementById('agentPicker')) return;
    const wrap = document.createElement('div');
    wrap.id = 'agentPicker';
    wrap.innerHTML = `
      <style>
        #agentPicker {
          position: fixed; top: 12px; right: 12px; z-index: 9999;
          font-family: system-ui, sans-serif; user-select: none;
          transition: opacity 0.3s;
        }
        #agentPicker.playing { opacity: 0; pointer-events: none; }
        #agentPicker .ap-toggle {
          background: rgba(8, 10, 24, 0.85); color: #cfd6ff;
          border: 1px solid rgba(120, 140, 255, 0.4); border-radius: 8px;
          padding: 8px 14px; font-size: 12px; letter-spacing: 0.08em;
          cursor: pointer; backdrop-filter: blur(6px);
        }
        #agentPicker .ap-toggle:hover { background: rgba(40, 50, 100, 0.9); }
        #agentPicker .ap-panel {
          margin-top: 8px; background: rgba(8, 10, 24, 0.92);
          border: 1px solid rgba(120, 140, 255, 0.3); border-radius: 8px;
          padding: 8px; width: 260px; display: none;
          backdrop-filter: blur(6px);
        }
        #agentPicker.open .ap-panel { display: block; }
        #agentPicker .ap-search {
          width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.4);
          color: #cfd6ff; border: 1px solid rgba(120, 140, 255, 0.3);
          border-radius: 6px; padding: 6px 8px; font-size: 12px;
          margin-bottom: 6px; outline: none;
        }
        #agentPicker .ap-list { max-height: 320px; overflow-y: auto; }
        #agentPicker .ap-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: 6px; cursor: pointer;
          color: #cfd6ff; font-size: 13px;
        }
        #agentPicker .ap-item:hover { background: rgba(80, 100, 200, 0.25); }
        #agentPicker .ap-item.active { background: rgba(80, 100, 200, 0.4); }
        #agentPicker .ap-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, #6699ff, #ff4488);
        }
        #agentPicker .ap-name {
          flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        #agentPicker .ap-owner { color: #6677aa; font-size: 10px; }
        #agentPicker .ap-empty { padding: 10px; color: #6677aa; font-size: 12px; text-align: center; }
      </style>
      <button class="ap-toggle" type="button">AGENT</button>
      <div class="ap-panel">
        <input class="ap-search" type="text" placeholder="Search avatars on three.ws..." />
        <div class="ap-list"></div>
      </div>
    `;
    document.body.appendChild(wrap);

    const toggle = wrap.querySelector('.ap-toggle');
    const search = wrap.querySelector('.ap-search');
    toggle.addEventListener('click', () => wrap.classList.toggle('open'));

    let searchTimer;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      this.searchQuery = search.value.trim();
      searchTimer = setTimeout(() => this.fetchPublicAvatars(this.searchQuery), 300);
    });

    this.overlayEl = wrap;
    this.listEl = wrap.querySelector('.ap-list');
  },

  renderList: function () {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    if (!this.agents.length) {
      this.listEl.innerHTML = '<div class="ap-empty">No avatars found.</div>';
      return;
    }
    this.agents.forEach(agent => {
      const item = document.createElement('div');
      item.className = 'ap-item' + (agent.id === this.currentId ? ' active' : '');
      item.dataset.id = agent.id;
      item.innerHTML = `
        <span class="ap-dot"></span>
        <span class="ap-name">${escapeHtml(agent.name)}</span>
        ${agent.owner ? `<span class="ap-owner">${escapeHtml(agent.owner)}</span>` : ''}
      `;
      item.addEventListener('click', () => {
        this.selectAgent(agent.id);
        this.overlayEl.classList.remove('open');
      });
      this.listEl.appendChild(item);
    });
  },

  applyInitialSelection: function () {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('agent');
    if (fromUrl && this.agents.some(a => a.id === fromUrl)) {
      this.selectAgent(fromUrl);
    } else {
      this.selectAgent(this.agents[0].id);
    }
    this.renderList();
  },

  selectAgent: function (idOrSpec) {
    let agent;
    if (typeof idOrSpec === 'string') {
      agent = this.agents.find(a => a.id === idOrSpec);
    } else if (idOrSpec && idOrSpec.url) {
      agent = idOrSpec;
      if (!this.agents.some(a => a.id === agent.id)) { this.agents.push(agent); }
    }
    if (!agent || !this.companionEl) return;

    this.currentId = agent.id;
    this.companionEl.setAttribute('gltf-model', `url(${agent.url})`);
    this.renderList();

    this.sceneEl.emit('agentchanged', { agentId: agent.id, url: agent.url });
  },

  wireSceneEvents: function () {
    const onPlay = () => this.overlayEl && this.overlayEl.classList.add('playing');
    const onStop = () => this.overlayEl && this.overlayEl.classList.remove('playing');
    this.sceneEl.addEventListener('songstartfade', onPlay);
    this.sceneEl.addEventListener('cleargame', onStop);
    this.sceneEl.addEventListener('gameover', onStop);
    this.sceneEl.addEventListener('songcomplete', onStop);
  },

  wirePostMessage: function () {
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg || msg.type !== 'rider:setAgent') return;
      if (msg.url) {
        this.selectAgent({
          id: msg.agentId || `external-${Date.now()}`,
          name: msg.name || 'Agent',
          url: msg.url
        });
      } else if (msg.agentId) {
        this.selectAgent(msg.agentId);
      }
    });
  }
});

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// In dev (non-production hosts) R2 lacks CORS for the forwarded origin,
// so route through the webpack-dev-server proxy. On three.ws the R2
// bucket allows the production origin directly.
function rewriteGlbUrl (url) {
  if (window.location.hostname === 'three.ws') return url;
  return url.replace(/^https:\/\/pub-2534e921bf9c4314addcd4d8a6e98b7b\.r2\.dev/, '/r2-proxy');
}
