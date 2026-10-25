import * as THREE from 'three'

export const cameraFocusTarget = { current: null as THREE.Vector3 | null }

/** Set this to an object id; ObjectGrid resolves it to a world position next frame. */
export const pendingFocusId = { current: null as string | null }
