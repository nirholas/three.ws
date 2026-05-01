AFRAME.registerComponent('agent-dance', {
  schema: {
    src: { default: '/assets/dance.json' }
  },

  init: function () {
    const el = this.el;
    const onLoaded = () => {
      const mesh = el.getObject3D('mesh');
      if (!mesh) return;
      fetch(this.data.src)
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          if (!json) return;
          const clip = THREE.AnimationClip.parse(json);
          this.mixer = new THREE.AnimationMixer(mesh);
          this.mixer.clipAction(clip).play();
        })
        .catch(() => {});
    };
    if (el.getObject3D('mesh')) { onLoaded(); }
    else { el.addEventListener('model-loaded', onLoaded); }
  },

  tick: function (t, dt) {
    if (this.mixer) { this.mixer.update(dt / 1000); }
  }
});
