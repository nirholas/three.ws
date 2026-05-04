/**
 * Firebase Realtime Database client for /rider multiplayer.
 *
 * Room shape at /rooms/{code}:
 *   {
 *     host: <uid>,
 *     createdAt: <serverTimestamp>,
 *     status: 'lobby' | 'playing' | 'finished',
 *     song: { id, difficulty, beatmapCharacteristic, difficultyId,
 *             songName, songSubName, image, version, directDownload,
 *             metadata, downloads, downloadsText, songDuration } | null,
 *     startAt: <ms epoch> | null,   // synchronized song start
 *     players: {
 *       <uid>: {
 *         name, joinedAt, ready,
 *         score, combo, maxCombo, accuracy, beatsHit, beatsMissed,
 *         finished, rank, finalScore
 *       }
 *     }
 *   }
 */
const firebase = require('firebase/app');
require('firebase/database');

const ROOM_CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LEN = 4;
const SCORE_WRITE_INTERVAL_MS = 250;
const START_DELAY_MS = 5000;

function genRoomCode () {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    s += ROOM_CODE_ALPHA[Math.floor(Math.random() * ROOM_CODE_ALPHA.length)];
  }
  return s;
}

function genUid () {
  const stored = localStorage.getItem('threewsmpuid');
  if (stored) return stored;
  const uid = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  localStorage.setItem('threewsmpuid', uid);
  return uid;
}

class MultiplayerClient {
  constructor (config) {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    } else {
      // The leaderboard component initializes firebase first; database picks up
      // databaseURL from the existing app.
    }
    this.db = firebase.database();
    this.uid = genUid();
    this.roomCode = null;
    this.roomRef = null;
    this.playerRef = null;
    this.isHost = false;
    this.lastScoreWrite = 0;
    this._roomListener = null;
    this._onRoomUpdate = null;
    this._serverOffset = 0;
    this.db.ref('.info/serverTimeOffset').on('value', snap => {
      this._serverOffset = snap.val() || 0;
    });
  }

  serverNow () {
    return Date.now() + this._serverOffset;
  }

  async createRoom (name) {
    // Try a few codes in case of collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genRoomCode();
      const ref = this.db.ref('rooms/' + code);
      const snap = await ref.once('value');
      if (snap.exists()) continue;
      const room = {
        host: this.uid,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        status: 'lobby',
        song: null,
        startAt: null,
        players: {
          [this.uid]: this._initialPlayer(name)
        }
      };
      await ref.set(room);
      this._attach(code, true);
      return code;
    }
    throw new Error('Could not generate unique room code');
  }

  async joinRoom (code, name) {
    code = (code || '').toUpperCase().trim();
    if (!code) throw new Error('Room code required');
    const ref = this.db.ref('rooms/' + code);
    const snap = await ref.once('value');
    if (!snap.exists()) throw new Error('Room not found');
    await ref.child('players/' + this.uid).set(this._initialPlayer(name));
    this._attach(code, false);
    return code;
  }

  _initialPlayer (name) {
    return {
      name: (name || 'Player').slice(0, 20),
      joinedAt: firebase.database.ServerValue.TIMESTAMP,
      ready: false,
      score: 0,
      combo: 0,
      maxCombo: 0,
      accuracy: 100,
      beatsHit: 0,
      beatsMissed: 0,
      finished: false,
      rank: '',
      finalScore: 0
    };
  }

  _attach (code, isHost) {
    this.roomCode = code;
    this.isHost = isHost;
    this.roomRef = this.db.ref('rooms/' + code);
    this.playerRef = this.roomRef.child('players/' + this.uid);
    // Auto-cleanup on disconnect.
    this.playerRef.onDisconnect().remove();
    this._roomListener = snap => {
      const v = snap.val();
      if (this._onRoomUpdate) this._onRoomUpdate(v);
    };
    this.roomRef.on('value', this._roomListener);
  }

  onRoomUpdate (cb) { this._onRoomUpdate = cb; }

  async leaveRoom () {
    if (!this.roomRef) return;
    try {
      this.roomRef.off('value', this._roomListener);
      await this.playerRef.onDisconnect().cancel();
      await this.playerRef.remove();
      // If host abandoned and was last player, drop room.
      const snap = await this.roomRef.child('players').once('value');
      if (!snap.exists()) {
        await this.roomRef.remove();
      } else if (this.isHost) {
        // Promote arbitrary remaining player to host.
        const nextHost = Object.keys(snap.val())[0];
        await this.roomRef.child('host').set(nextHost);
      }
    } catch (e) { /* best-effort */ }
    this.roomCode = null;
    this.roomRef = null;
    this.playerRef = null;
    this.isHost = false;
  }

  async setReady (ready) {
    if (!this.playerRef) return;
    await this.playerRef.child('ready').set(!!ready);
  }

  async setName (name) {
    if (!this.playerRef) return;
    await this.playerRef.child('name').set((name || 'Player').slice(0, 20));
  }

  /**
   * Host: broadcast the selected song to all players in the room.
   */
  async broadcastSong (challenge) {
    if (!this.isHost || !this.roomRef) return;
    const safe = {
      id: challenge.id || '',
      difficulty: challenge.difficulty || '',
      beatmapCharacteristic: challenge.beatmapCharacteristic || '',
      difficultyId: challenge.difficultyId || '',
      songName: challenge.songName || '',
      songSubName: challenge.songSubName || '',
      image: challenge.image || challenge.coverURL || '',
      version: challenge.version || '',
      directDownload: challenge.directDownload || '',
      downloads: challenge.downloads || '',
      downloadsText: challenge.downloadsText || '',
      songDuration: challenge.songDuration || 0,
      metadata: challenge.metadata || {}
    };
    await this.roomRef.update({ song: safe });
    // Reset all players' ready flags when song changes.
    const players = (await this.roomRef.child('players').once('value')).val() || {};
    const updates = {};
    Object.keys(players).forEach(uid => {
      updates['players/' + uid + '/ready'] = false;
      updates['players/' + uid + '/finished'] = false;
      updates['players/' + uid + '/score'] = 0;
      updates['players/' + uid + '/finalScore'] = 0;
      updates['players/' + uid + '/combo'] = 0;
      updates['players/' + uid + '/maxCombo'] = 0;
      updates['players/' + uid + '/accuracy'] = 100;
      updates['players/' + uid + '/beatsHit'] = 0;
      updates['players/' + uid + '/beatsMissed'] = 0;
      updates['players/' + uid + '/rank'] = '';
    });
    await this.roomRef.update(updates);
  }

  /**
   * Host: schedule synchronized start. All clients begin the song at startAt.
   */
  async startSong (delayMs) {
    if (!this.isHost || !this.roomRef) return;
    const startAt = this.serverNow() + (typeof delayMs === 'number' ? delayMs : START_DELAY_MS);
    await this.roomRef.update({ status: 'playing', startAt });
    return startAt;
  }

  /**
   * Throttled live score push.
   */
  pushScore (score) {
    if (!this.playerRef) return;
    const now = Date.now();
    if (now - this.lastScoreWrite < SCORE_WRITE_INTERVAL_MS) return;
    this.lastScoreWrite = now;
    this.playerRef.update({
      score: score.score | 0,
      combo: score.combo | 0,
      maxCombo: score.maxCombo | 0,
      accuracy: parseFloat(score.accuracy) || 0,
      beatsHit: score.beatsHit | 0,
      beatsMissed: score.beatsMissed | 0
    });
  }

  async pushFinal (score) {
    if (!this.playerRef) return;
    await this.playerRef.update({
      finished: true,
      finalScore: score.score | 0,
      score: score.score | 0,
      maxCombo: score.maxCombo | 0,
      accuracy: parseFloat(score.accuracy) || 0,
      beatsHit: score.beatsHit | 0,
      beatsMissed: score.beatsMissed | 0,
      rank: score.rank || ''
    });
    if (this.isHost && this.roomRef) {
      // Mark room finished once host reports done; players may still be on outro.
      this.roomRef.update({ status: 'finished' });
    }
  }

  async resetForRematch () {
    if (!this.isHost || !this.roomRef) return;
    await this.roomRef.update({ status: 'lobby', startAt: null });
  }
}

module.exports = { MultiplayerClient, START_DELAY_MS };
