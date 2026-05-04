const { MultiplayerClient } = require('../lib/multiplayer');

/**
 * Wires Firebase Realtime Database multiplayer rooms into the rider state.
 *
 * Async-race model: host picks song, broadcasts, all players start loading
 * locally and run on their own clock. Live scores stream into a shared room
 * node so each player can see opponents' progress. Final scores compared on
 * victory screen.
 *
 * Events consumed (on a-scene):
 *   mpcreate                              create room as host
 *   mpjoin    {code}                      join existing room
 *   mpleave                               leave / cleanup
 *   mpready   {value}                     toggle ready flag in lobby
 *   mpsetname {value}                     update display name
 *   mprematch                             host: reset room to lobby
 *
 * Events emitted (on a-scene):
 *   mproomjoined     {code, isHost}
 *   mproomleft
 *   mproomupdate     {code, isHost, uid, status, song, startAt, players}
 *   mpremotesongselect <songObj>          non-host: host picked a song
 *   mpremoteplaystart                     non-host: host pressed start
 *   mperror          {message}
 */
AFRAME.registerComponent('multiplayer', {
  schema: {
    apiKey: { type: 'string' },
    authDomain: { type: 'string' },
    databaseURL: { type: 'string' },
    projectId: { type: 'string' },
    storageBucket: { type: 'string' },
    messagingSenderId: { type: 'string' }
  },

  init: function () {
    this.client = null;
    this.lastRoom = null;

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

    const sceneEl = this.el.sceneEl || this.el;
    sceneEl.addEventListener('mpcreate', this.onCreate);
    sceneEl.addEventListener('mpjoin', this.onJoin);
    sceneEl.addEventListener('mpleave', this.onLeave);
    sceneEl.addEventListener('mpready', this.onReady);
    sceneEl.addEventListener('mpsetname', this.onSetName);
    sceneEl.addEventListener('mprematch', this.onRematch);
    sceneEl.addEventListener('beathit', this.onBeatHit);
    sceneEl.addEventListener('beatmiss', this.onBeatMiss);
    sceneEl.addEventListener('beatwrong', this.onBeatMiss);
    sceneEl.addEventListener('songcomplete', this.onSongComplete);
    // Capture phase so we read menuSelectedChallenge before the state handler clears it.
    sceneEl.addEventListener('playbuttonclick', this.onPlayButtonClick, true);
  },

  _ensureClient: function () {
    if (this.client) return this.client;
    if (!this.data.apiKey) {
      console.error('[multiplayer] Missing Firebase config');
      return null;
    }
    this.client = new MultiplayerClient({
      apiKey: this.data.apiKey,
      authDomain: this.data.authDomain,
      databaseURL: this.data.databaseURL,
      projectId: this.data.projectId,
      storageBucket: this.data.storageBucket,
      messagingSenderId: this.data.messagingSenderId
    });
    this.client.onRoomUpdate(this.onRoomUpdate);
    return this.client;
  },

  _name: function () {
    return localStorage.getItem('threewsusername') || 'Player';
  },

  onCreate: async function () {
    const c = this._ensureClient();
    if (!c) return;
    try {
      const code = await c.createRoom(this._name());
      this.el.sceneEl.emit('mproomjoined', { code, isHost: true }, false);
    } catch (e) {
      console.error('[multiplayer] create failed', e);
      this.el.sceneEl.emit('mperror', { message: 'Could not create room' }, false);
    }
  },

  onJoin: async function (evt) {
    const c = this._ensureClient();
    if (!c) return;
    const code = (evt.detail && evt.detail.code) || '';
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
    this.el.sceneEl.emit('mproomleft', null, false);
  },

  onReady: function (evt) {
    if (!this.client) return;
    this.client.setReady(evt.detail && evt.detail.value);
  },

  onSetName: function (evt) {
    if (!this.client) return;
    this.client.setName((evt.detail && evt.detail.value) || this._name());
  },

  onRematch: async function () {
    if (!this.client) return;
    await this.client.resetForRematch();
  },

  /**
   * When local user presses play in MP mode and is host, broadcast to room.
   * Non-host's playbuttonclick is suppressed via state guard, so this is
   * effectively host-only.
   */
  onPlayButtonClick: function () {
    if (!this.client || !this.client.roomRef) return;
    const state = this.el.sceneEl.systems.state.state;
    if (!state.multiplayer || !state.multiplayer.active) return;
    if (!this.client.isHost) return;
    const challenge = Object.assign({}, state.menuSelectedChallenge);
    this.client.broadcastSong(challenge)
      .then(() => this.client.startSong())
      .catch(err => console.error('[multiplayer] host start failed', err));
  },

  onBeatHit: function () {
    if (!this.client || !this.client.roomRef) return;
    const state = this.el.sceneEl.systems.state.state;
    this.client.pushScore(state.score);
  },

  onBeatMiss: function () {
    if (!this.client || !this.client.roomRef) return;
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
      this.el.sceneEl.emit('mproomleft', null, false);
      return;
    }
    const sceneEl = this.el.sceneEl;
    const playerEntries = Object.keys(room.players || {}).map(uid => ({
      uid,
      ...room.players[uid]
    })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

    sceneEl.emit('mproomupdate', {
      code: this.client.roomCode,
      isHost: room.host === this.client.uid,
      uid: this.client.uid,
      status: room.status,
      song: room.song,
      startAt: room.startAt,
      players: playerEntries
    }, false);

    // Non-host: when host broadcasts a new song, surface it.
    if (!this.client.isHost && room.song && room.song.id) {
      const prevSongId = this.lastRoom && this.lastRoom.song && this.lastRoom.song.id;
      if (room.song.id !== prevSongId) {
        sceneEl.emit('mpremotesongselect', room.song, false);
      }
    }

    // Non-host: status flips to playing → trigger local play.
    if (!this.client.isHost && room.status === 'playing') {
      const prevStatus = this.lastRoom && this.lastRoom.status;
      if (prevStatus !== 'playing') {
        sceneEl.emit('mpremoteplaystart', null, false);
      }
    }

    this.lastRoom = room;
  }
});
