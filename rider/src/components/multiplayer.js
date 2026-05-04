const { MultiplayerClient } = require('../lib/multiplayer');

const COUNTDOWN_MS = 5000;
const SCORE_TICK_MS = 250;

/**
 * Wires Firebase Realtime Database multiplayer rooms into the rider state.
 *
 * Synchronized-race model: host picks song and presses PLAY. We broadcast
 * `song` + `startAt = serverNow + 5s`. All clients (including host) display a
 * countdown bound to wall-clock startAt. When countdown hits zero, every
 * client triggers local playback. Loading happens during the countdown.
 *
 * Live state streams via per-player nodes; opponent HUD shows rank + delta.
 */
AFRAME.registerComponent('multiplayer', {
  schema: {},

  init: function () {
    this.client = null;
    this.lastRoom = null;
    this.pendingStartAt = null;
    this._scheduledFire = false;
    this._lastCountdownLabel = '';
    this._lastScoreTick = 0;

    this.onCreate = this.onCreate.bind(this);
    this.onJoin = this.onJoin.bind(this);
    this.onLeave = this.onLeave.bind(this);
    this.onReady = this.onReady.bind(this);
    this.onSetName = this.onSetName.bind(this);
    this.onPlayButtonClick = this.onPlayButtonClick.bind(this);
    this.onBeatHit = this.onBeatHit.bind(this);
    this.onBeatMiss = this.onBeatMiss.bind(this);
    this.onSongComplete = this.onSongComplete.bind(this);
    this.onRematch = this.onRematch.bind(this);
    this.onRoomUpdate = this.onRoomUpdate.bind(this);
    this.onShareLink = this.onShareLink.bind(this);

    const sceneEl = this.el.sceneEl || this.el;
    sceneEl.addEventListener('mpcreate', this.onCreate);
    sceneEl.addEventListener('mpjoin', this.onJoin);
    sceneEl.addEventListener('mpleave', this.onLeave);
    sceneEl.addEventListener('mpready', this.onReady);
    sceneEl.addEventListener('mpsetname', this.onSetName);
    sceneEl.addEventListener('mprematch', this.onRematch);
    sceneEl.addEventListener('mpsharelink', this.onShareLink);
    sceneEl.addEventListener('beathit', this.onBeatHit);
    sceneEl.addEventListener('beatmiss', this.onBeatMiss);
    sceneEl.addEventListener('beatwrong', this.onBeatMiss);
    sceneEl.addEventListener('songcomplete', this.onSongComplete);
    sceneEl.addEventListener('playbuttonclick', this.onPlayButtonClick, true);

    const autoJoin = AFRAME.utils.getUrlParameter('mpjoin');
    if (autoJoin) {
      setTimeout(() => {
        sceneEl.emit('mpopen', null, false);
        sceneEl.emit('mpjoin', { code: autoJoin }, false);
      }, 250);
    }
  },

  _ensureClient: async function () {
    if (this.client) return this.client;

    try {
      const response = await fetch('/api/rider/firebase');
      const firebaseConfig = await response.json();

      if (firebaseConfig.apiKey) {
        this.client = new MultiplayerClient(firebaseConfig);
        this.client.onRoomUpdate(this.onRoomUpdate);
        return this.client;
      } else {
        console.error('[multiplayer] Missing Firebase config');
        return null;
      }
    } catch (e) {
      console.error('[multiplayer] Error fetching Firebase config', e);
      return null;
    }
  },

  _name: function () {
    return localStorage.getItem('threewsusername') || 'Player';
  },

  onCreate: async function () {
    const c = await this._ensureClient();
    if (!c) return;
    this.el.sceneEl.emit('mpconnecting', null, false);
    try {
      const code = await c.createRoom(this._name());
      this.el.sceneEl.emit('mproomjoined', { code, isHost: true }, false);
    } catch (e) {
      console.error('[multiplayer] create failed', e);
      this.el.sceneEl.emit('mperror', { message: 'Could not create room' }, false);
    }
  },

  onJoin: async function (evt) {
    const c = await this._ensureClient();
    if (!c) return;
    const code = (evt.detail && evt.detail.code) || '';
    if (!code || code.length < 4) {
      this.el.sceneEl.emit('mperror', { message: 'Enter a 4-letter room code' }, false);
      return;
    }
    this.el.sceneEl.emit('mpconnecting', null, false);
    try {
      await c.joinRoom(code, this._name());
      this.el.sceneEl.emit('mproomjoined', { code: code.toUpperCase(), isHost: false }, false);
    } catch (e) {
      console.error('[multiplayer] join failed', e);
      this.el.sceneEl.emit('mperror', { message: e.message || 'Join failed' }, false);
    }
  },

  onLeave: async function () {
    if (!this.client) return;
    await this.client.leaveRoom();
    this.lastRoom = null;
    this.pendingStartAt = null;
    this.el.sceneEl.emit('mproomleft', null, false);
  },

  onReady: function (evt) {
    if (!this.client) return;
    this.client.setReady(evt.detail && evt.detail.value);
  },

  onSetName: function (evt) {
    if (!this.client) return;
    const name = (evt.detail && (evt.detail.value || evt.detail)) || this._name();
    localStorage.setItem('threewsusername', String(name).slice(0, 20));
    this.client.setName(name);
  },

  onRematch: async function () {
    if (!this.client) return;
    this.pendingStartAt = null;
    await this.client.resetForRematch();
  },

  onShareLink: function () {
    if (!this.client || !this.client.roomCode) return;
    const url = window.location.origin + window.location.pathname + '?mpjoin=' + this.client.roomCode;
    const flashCopied = () => {
      this.el.sceneEl.emit('mpsharelinkcopied', { url }, false);
      setTimeout(() => this.el.sceneEl.emit('mpsharelinkcleared', null, false), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(flashCopied,
        () => window.prompt('Share this link:', url));
    } else {
      window.prompt('Share this link:', url);
      flashCopied();
    }
  },

  /**
   * Host: capture in-MP playbuttonclick, broadcast song + countdown rather
   * than letting the state handler immediately enter the play flow.
   * Non-host: their play button is hidden, but defensively guard anyway.
   */
  onPlayButtonClick: function (evt) {
    if (this._scheduledFire) return; // our own re-emit, let it through
    if (!this.client || !this.client.roomRef) return;
    const state = this.el.sceneEl.systems.state.state;
    if (!state.multiplayer || !state.multiplayer.active) return;

    if (!this.client.isHost) {
      evt.stopImmediatePropagation();
      evt.preventDefault();
      return;
    }
    if (state.multiplayer.players.length < 2) {
      evt.stopImmediatePropagation();
      evt.preventDefault();
      this.el.sceneEl.emit('mperror', { message: 'Need at least 2 players' }, false);
      return;
    }

    // Stop the state handler — countdown will trigger play later.
    evt.stopImmediatePropagation();
    evt.preventDefault();

    const challenge = Object.assign({}, state.menuSelectedChallenge);
    this.client.broadcastSong(challenge)
      .then(() => this.client.startSong(COUNTDOWN_MS))
      .catch(err => {
        console.error('[multiplayer] host start failed', err);
        this.el.sceneEl.emit('mperror', { message: 'Failed to start song' }, false);
      });
  },

  onBeatHit: function () {
    this._maybePushScore();
  },
  onBeatMiss: function () {
    this._maybePushScore();
  },

  _maybePushScore: function () {
    if (!this.client || !this.client.roomRef) return;
    const now = performance.now();
    if (now - this._lastScoreTick < SCORE_TICK_MS) return;
    this._lastScoreTick = now;
    const state = this.el.sceneEl.systems.state.state;
    this.client.pushScore(state.score);
  },

  onSongComplete: function () {
    if (!this.client || !this.client.roomRef) return;
    const state = this.el.sceneEl.systems.state.state;
    this.client.pushFinal(state.score);
  },

  onRoomUpdate: function (room) {
    if (!room) {
      this.pendingStartAt = null;
      this.el.sceneEl.emit('mproomleft', null, false);
      return;
    }
    const sceneEl = this.el.sceneEl;
    const myUid = this.client.uid;
    const playerEntries = Object.keys(room.players || {}).map(uid => ({
      uid,
      ...room.players[uid]
    })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

    sceneEl.emit('mproomupdate', {
      code: this.client.roomCode,
      isHost: room.host === myUid,
      hostUid: room.host,
      uid: myUid,
      status: room.status,
      song: room.song,
      startAt: room.startAt,
      players: playerEntries
    }, false);

    // Non-host: when host broadcasts a new song, mirror selection.
    if (!this.client.isHost && room.song && room.song.id) {
      const prevSongId = this.lastRoom && this.lastRoom.song && this.lastRoom.song.id;
      if (room.song.id !== prevSongId) {
        sceneEl.emit('mpremotesongselect', room.song, false);
      }
    }

    // Sync start: any client with a fresh startAt + status==playing arms tick.
    if (room.status === 'playing' && room.startAt) {
      const prevStart = this.lastRoom && this.lastRoom.startAt;
      if (room.startAt !== prevStart) {
        this.pendingStartAt = room.startAt;
      }
    }

    // Rematch: status returned to lobby — clear any pending timer.
    if (room.status === 'lobby') {
      this.pendingStartAt = null;
    }

    this.lastRoom = room;
  },

  /**
   * Drive the countdown text and trigger the synchronized fire.
   */
  tick: function () {
    if (!this.client) return;
    if (this.pendingStartAt) {
      const delta = this.pendingStartAt - this.client.serverNow();
      const secs = Math.max(0, Math.ceil(delta / 1000));
      const label = secs > 0 ? ('STARTING IN ' + secs) : 'GO!';
      if (label !== this._lastCountdownLabel) {
        this._lastCountdownLabel = label;
        this.el.sceneEl.emit('mpcountdown', { value: label, secs, active: true }, false);
      }
      if (delta <= 0) {
        const startAt = this.pendingStartAt;
        this.pendingStartAt = null;
        this._fireLocalStart();
        // Hold "GO!" briefly then clear.
        setTimeout(() => {
          this.el.sceneEl.emit('mpcountdown', { value: '', secs: 0, active: false }, false);
          this._lastCountdownLabel = '';
        }, 600);
        // Mark we already fired for this startAt.
        this._lastFiredStartAt = startAt;
      }
    }
  },

  _fireLocalStart: function () {
    const state = this.el.sceneEl.systems.state.state;
    if (this.client.isHost) {
      // Re-emit playbuttonclick; our capture-phase handler will let it through
      // because _scheduledFire is set.
      this._scheduledFire = true;
      try {
        this.el.sceneEl.emit('playbuttonclick', null, false);
      } finally {
        this._scheduledFire = false;
      }
    } else {
      // Non-host: needs a populated menuSelectedChallenge from the room song.
      if (!state.menuSelectedChallenge.id) {
        console.warn('[multiplayer] non-host fire without song selected');
        return;
      }
      this.el.sceneEl.emit('mpremoteplaystart', null, false);
    }
  }
});
