const COLORS = require('../constants/colors.js');

const iconPositions = {
  classicvr: -0.6,
  punchvr: 0.87,
  ride2d: 0.87,
  ridevr: 0.15,
  viewer2d: 0.15
};

const modeMap = {
  classicvr: 'classic',
  punchvr: 'punch',
  ride2d: 'ride',
  ridevr: 'ride',
  viewer2d: 'viewer'
};

/**
 * Click target that opens the multiplayer lobby panel.
 */
AFRAME.registerComponent('multiplayer-button', {
  init: function () {
    this.el.addEventListener('click', () => {
      this.el.sceneEl.emit('mpopen', null, false);
    });
  }
});

/**
 * Click prompts for a 4-char room code and dispatches mpjoin.
 * Falls back to window.prompt — works in 2D viewer + Quest browser.
 */
AFRAME.registerComponent('multiplayer-join-button', {
  init: function () {
    this.el.addEventListener('click', () => {
      const code = window.prompt('Enter 4-letter room code:');
      if (!code) { return; }
      const normalized = code.toUpperCase().trim().slice(0, 4);
      this.el.sceneEl.emit('mpcodeinput', normalized, false);
      this.el.sceneEl.emit('mpjoin', { code: normalized }, false);
    });
  }
});

/**
 * Click toggles the local player's ready flag.
 */
AFRAME.registerComponent('multiplayer-ready-button', {
  init: function () {
    this.el.addEventListener('click', () => {
      const sceneEl = this.el.sceneEl;
      const state = sceneEl.systems.state.state;
      const me = state.multiplayer.players.find(p => p.uid === state.multiplayer.uid);
      const next = me ? !me.ready : true;
      sceneEl.emit('mpready', { value: next }, false);
    });
  }
});

AFRAME.registerComponent('menu-mode', {
  schema: {
    colorScheme: {default: 'default'},
    hasVR: {default: false}
  },

  init: function () {
    this.el.addEventListener('click', evt => {
      const item = evt.target.closest('[data-mode]');
      const mode = item.dataset.mode;
      const name = item.dataset.name;
      this.el.sceneEl.emit('gamemode', mode, false);
      localStorage.setItem('gameMode', name);
      this.setModeOption(name);
    });
  },

  update: function () {
    const stored = localStorage.getItem('gameMode') || 'punchvr';
    this.setModeOption(stored);
    this.el.sceneEl.emit('gamemode', modeMap[stored]);
  },

  setModeOption: function (name) {
    const modeEls = this.el.querySelectorAll('.modeItem');
    document.getElementById('modeIcon').object3D.position.y = iconPositions[name];

    for (let i = 0; i < modeEls.length; i++) {
      const modeEl = modeEls[i];
      const selected = modeEl.dataset.name === name;

      modeEl.emit(selected ? 'select' : 'deselect', null, false);

      const background = modeEl.querySelector('.modeBackground');
      background.emit(selected ? 'select' : 'deselect', null, false);
      background.setAttribute(
        'mixin',
        'modeBackgroundSelect' + (selected ? '' : ' modeBackgroundHover'));

      const thumb = modeEl.querySelector('.modeThumb');
      thumb.emit(selected ? 'select' : 'deselect', null, false);

      const title = modeEl.querySelector('.modeTitle');
      title.setAttribute(
        'text', 'color',
        selected ? COLORS.WHITE : COLORS.schemes[this.data.colorScheme].secondary);

      const instructions = modeEl.querySelector('.modeInstructions');
      instructions.setAttribute(
        'text', 'color',
        selected ? COLORS.WHITE : COLORS.schemes[this.data.colorScheme].primary);
    }
  }
});
