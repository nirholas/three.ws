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
 * Click opens the VR room-code keyboard when in VR; falls back to prompt().
 */
AFRAME.registerComponent('multiplayer-join-button', {
  init: function () {
    this.el.addEventListener('click', () => {
      const sceneEl = this.el.sceneEl;
      const state = sceneEl.systems.state.state;
      if (state.inVR) {
        sceneEl.emit('mpkeyboardopen', null, false);
        return;
      }
      const code = window.prompt('Enter 4-letter room code:');
      if (!code) return;
      const normalized = code.toUpperCase().trim().slice(0, 4);
      sceneEl.emit('mpcodeinput', normalized, false);
      sceneEl.emit('mpjoin', { code: normalized }, false);
    });
  }
});

/**
 * Submit handler for the VR room-code keyboard: dismiss + fire join.
 */
AFRAME.registerComponent('multiplayer-keyboard-bridge', {
  init: function () {
    const sceneEl = this.el.sceneEl;
    sceneEl.addEventListener('mpkeyboardsubmit', () => {
      const state = sceneEl.systems.state.state;
      const code = (state.multiplayer.joinCodeInput || '').toUpperCase().slice(0, 4);
      sceneEl.emit('mpkeyboardclose', null, false);
      if (code.length === 4) {
        sceneEl.emit('mpjoin', { code }, false);
      } else {
        sceneEl.emit('mperror', { message: 'Enter all 4 letters' }, false);
      }
    });
    sceneEl.addEventListener('mpnamekeyboardsubmit', () => {
      const state = sceneEl.systems.state.state;
      const name = (state.multiplayer.nameInput || '').trim().slice(0, 14) || 'Player';
      sceneEl.emit('mpnamekeyboardclose', null, false);
      sceneEl.emit('mpsetname', { value: name }, false);
    });
  }
});

/**
 * Opens the VR name keyboard, or prompt() in 2D.
 */
AFRAME.registerComponent('multiplayer-name-button', {
  init: function () {
    this.el.addEventListener('click', () => {
      const sceneEl = this.el.sceneEl;
      const state = sceneEl.systems.state.state;
      if (state.inVR) {
        sceneEl.emit('mpnamekeyboardopen', null, false);
        return;
      }
      const name = window.prompt('Your display name:',
        localStorage.getItem('threewsusername') || 'Player');
      if (!name) return;
      sceneEl.emit('mpsetname', { value: name.trim().slice(0, 14) }, false);
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
      if (!item) return; // non-mode click (e.g. multiplayer button)
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
