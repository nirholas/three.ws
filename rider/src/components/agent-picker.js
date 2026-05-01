/* global AFRAME */
// Renders a small HTML overlay listing available agent avatars and swaps the
// gltf-model on #agentCompanion when one is picked. Sources: hardcoded list,
// ?agent=<id> URL param, or a postMessage from a parent host frame.
//
// postMessage protocol (parent → rider iframe):
//   { type: 'rider:setAgent', agentId: 'cz' }
//   { type: 'rider:setAgent', url: 'https://.../foo.glb', name: 'Foo' }

const DEFAULT_AGENTS = [
  { id: 'cz', name: 'CZ', url: 'https://raw.githubusercontent.com/overstepping/-/main/cz.glb' },
  { id: 'sbf', name: 'SBF', url: 'https://raw.githubusercontent.com/overstepping/-/main/sbf.glb' },
  { id: 'vitalik', name: 'Vitalik', url: 'https://raw.githubusercontent.com/overstepping/-/main/vitalik.glb' },
  { id: 'satoshi', name: 'Satoshi', url: 'https://raw.githubusercontent.com/overstepping/-/main/satoshi.glb' }
];

AFRAME.registerSystem('agent-picker', {
  init: function () {
    this.agents = DEFAULT_AGENTS.slice();
    this.currentId = null;
    this.companionEl = null;

    const ready = () => {
      this.companionEl = document.querySelector('#agentCompanion');
      if (!this.companionEl) return;
      this.buildOverlay();
      this.applyInitialSelection();
      this.wireSceneEvents();
      this.wirePostMessage();
    };

    if (this.sceneEl.hasLoaded) { ready(); }
    else { this.sceneEl.addEventListener('loaded', ready); }
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
        #agentPicker .ap-list {
          margin-top: 8px; background: rgba(8, 10, 24, 0.92);
          border: 1px solid rgba(120, 140, 255, 0.3); border-radius: 8px;
          padding: 6px; min-width: 180px; display: none;
          backdrop-filter: blur(6px);
        }
        #agentPicker.open .ap-list { display: block; }
        #agentPicker .ap-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: 6px; cursor: pointer;
          color: #cfd6ff; font-size: 13px;
        }
        #agentPicker .ap-item:hover { background: rgba(80, 100, 200, 0.25); }
        #agentPicker .ap-item.active { background: rgba(80, 100, 200, 0.4); }
        #agentPicker .ap-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: linear-gradient(135deg, #6699ff, #ff4488);
        }
      </style>
      <button class="ap-toggle" type="button">AGENT</button>
      <div class="ap-list"></div>
    `;
    document.body.appendChild(wrap);

    const toggle = wrap.querySelector('.ap-toggle');
    const list = wrap.querySelector('.ap-list');
    toggle.addEventListener('click', () => wrap.classList.toggle('open'));

    this.agents.forEach(agent => {
      const item = document.createElement('div');
      item.className = 'ap-item';
      item.dataset.id = agent.id;
      item.innerHTML = `<span class="ap-dot"></span><span>${agent.name}</span>`;
      item.addEventListener('click', () => {
        this.selectAgent(agent.id);
        wrap.classList.remove('open');
      });
      list.appendChild(item);
    });

    this.overlayEl = wrap;
  },

  applyInitialSelection: function () {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('agent');
    if (fromUrl && this.agents.some(a => a.id === fromUrl)) {
      this.selectAgent(fromUrl);
      return;
    }
    this.selectAgent(this.agents[0].id);
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

    if (this.overlayEl) {
      this.overlayEl.querySelectorAll('.ap-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === agent.id);
      });
    }

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
