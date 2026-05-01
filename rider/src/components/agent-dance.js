const CLIPS = [
  'dance', 'rumba', 'capoeira', 'thriller', 'wave', 'celebrate', 'taunt',
  'silly', 'jump', 'pray', 'reaction', 'sitclap', 'sitlaugh', 'kiss',
  'angry', 'defeated', 'falling', 'dying', 'idle'
];

AFRAME.registerComponent('agent-dance', {
  schema: {
    base: { default: 'assets/clips/' },
    initial: { default: 'dance' }
  },

  init: function () {
    this.clips = {};
    this.currentAction = null;
    const el = this.el;
    const onLoaded = () => {
      const mesh = el.getObject3D('mesh');
      if (!mesh) return;
      this.mixer = new THREE.AnimationMixer(mesh);
      this.play(this.data.initial);
      this.buildUI();
    };
    if (el.getObject3D('mesh')) { onLoaded(); }
    else { el.addEventListener('model-loaded', onLoaded); }

    this.onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const idx = '1234567890'.indexOf(e.key);
      if (idx >= 0 && CLIPS[idx]) {
        this.play(CLIPS[idx]);
        if (this.ui) this.ui.value = CLIPS[idx];
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  },

  remove: function () {
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.ui) this.ui.remove();
  },

  play: function (name) {
    if (!this.mixer) return;
    const swap = (clip) => {
      const next = this.mixer.clipAction(clip);
      next.reset().play();
      if (this.currentAction && this.currentAction !== next) {
        this.currentAction.crossFadeTo(next, 0.3, false);
      }
      this.currentAction = next;
    };
    if (this.clips[name]) { swap(this.clips[name]); return; }
    fetch(this.data.base + name + '.json')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json) return;
        const clip = THREE.AnimationClip.parse(json);
        this.clips[name] = clip;
        swap(clip);
      })
      .catch(() => {});
  },

  buildUI: function () {
    const ui = document.createElement('select');
    ui.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999998;background:rgba(0,0,0,0.7);color:#fff;font-family:monospace;padding:6px;border:1px solid #444;border-radius:4px;';
    ui.title = 'Agent animation (1-0 keys also work)';
    CLIPS.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = name;
      const key = i < 10 ? `[${(i + 1) % 10}] ` : '';
      opt.textContent = key + name;
      if (name === this.data.initial) opt.selected = true;
      ui.appendChild(opt);
    });
    ui.addEventListener('change', () => this.play(ui.value));
    document.body.appendChild(ui);
    this.ui = ui;
  },

  tick: function (t, dt) {
    if (this.mixer) this.mixer.update(dt / 1000);
  }
});
