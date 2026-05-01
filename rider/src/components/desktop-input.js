/**
 * Desktop mouse/keyboard input. Drives left/right hand entities via pointer
 * position when no VR controller is connected. Left mouse = right hand swing,
 * right mouse (or shift) = left hand swing. Hand z-position lunges forward
 * briefly on click to register a punch hit via velocity sampling in punch.js.
 */
const PLAY_AREA = {x: 0.6, y: 0.5};
const REST_Z = 0;
const LUNGE_Z = -0.6;
const LUNGE_MS = 140;

AFRAME.registerComponent('desktop-input', {
  schema: {
    hand: {default: 'right', oneOf: ['left', 'right']}
  },

  init: function () {
    this.target = new THREE.Vector3(this.data.hand === 'right' ? 0.25 : -0.25, 1.4, REST_Z);
    this.lungeUntil = 0;
    this.hasController = false;

    this.el.addEventListener('controllerconnected', () => { this.hasController = true; });

    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onContextMenu = e => e.preventDefault();

    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('contextmenu', this.onContextMenu);
  },

  remove: function () {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('contextmenu', this.onContextMenu);
  },

  onMouseMove: function (evt) {
    const nx = (evt.clientX / window.innerWidth) * 2 - 1;
    const ny = (evt.clientY / window.innerHeight) * 2 - 1;
    this.target.x = (this.data.hand === 'right' ? 0.25 : -0.25) + nx * PLAY_AREA.x;
    this.target.y = 1.4 - ny * PLAY_AREA.y;
  },

  onMouseDown: function (evt) {
    const isRightHand = this.data.hand === 'right';
    const wantLeft = evt.button === 2 || evt.shiftKey;
    if (isRightHand && wantLeft) { return; }
    if (!isRightHand && !wantLeft) { return; }
    this.lungeUntil = performance.now() + LUNGE_MS;
    this.el.emit('triggerdown', null, false);
    setTimeout(() => this.el.emit('triggerup', null, false), LUNGE_MS);
  },

  tick: function () {
    if (this.hasController) { return; }
    const obj = this.el.object3D;
    const lunging = performance.now() < this.lungeUntil;
    obj.position.x += (this.target.x - obj.position.x) * 0.35;
    obj.position.y += (this.target.y - obj.position.y) * 0.35;
    const targetZ = lunging ? LUNGE_Z : this.target.z;
    obj.position.z += (targetZ - obj.position.z) * 0.5;
  }
});
