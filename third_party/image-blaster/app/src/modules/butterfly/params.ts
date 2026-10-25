type Folder = 'Flight' | 'Camera' | 'Shake' | 'Flock' | 'Noise' | 'Appearance' | 'Audio' | null

interface NumSpec {
  value: number
  min: number
  max: number
  step: number
  folder: Folder
  label?: string
}
interface BoolSpec {
  value: boolean
  folder: Folder
  label?: string
}
type Spec = NumSpec | BoolSpec

export const FOLDER_ORDER: Exclude<Folder, null>[] = ['Flight', 'Camera', 'Shake', 'Flock', 'Noise', 'Appearance', 'Audio']

export const PARAM_SPECS = {
  paused: { value: false, folder: null, label: 'Pause Movement' },
  showDebug: { value: false, folder: null, label: 'Show Debug Wireframes' },

  flightSpeed: { value: .3, min: 0, max: 1, step: 0.1, folder: 'Flight' },
  rotationSpeed: { value: 1.5, min: 0, max: 6, step: 0.05, folder: 'Flight' },
  targetRadius: { value: 0.2, min: 0.05, max: 2, step: 0.01, folder: 'Flight' },

  cameraPositionLerp: { value: 2.5, min: 0.1, max: 30, step: 0.1, folder: 'Camera' },
  cameraRotationLerp: { value: 8, min: 0.1, max: 60, step: 0.1, folder: 'Camera' },
  mouseSensitivity: { value: 0.0005, min: 0.0005, max: 0.02, step: 0.0005, folder: 'Camera' },
  invertY: { value: true, folder: 'Camera', label: 'Invert Y' },
  minDistance: { value: 0.3, min: 0.1, max: 10, step: 0.05, folder: 'Camera' },
  maxDistance: { value: 0.8, min: 0.2, max: 50, step: 0.1, folder: 'Camera' },
  defaultDistance: { value: 0.5, min: 0.1, max: 50, step: 0.05, folder: 'Camera' },
  cameraHeightOffset: { value: 0, min: -2, max: 2, step: 0.01, folder: 'Camera' },
  zoomSpeed: { value: 1.0, min: 0.1, max: 5, step: 0.05, folder: 'Camera' },
  zoomLerp: { value: 8, min: 0.5, max: 30, step: 0.5, folder: 'Camera' },
  nearFov: { value: 60, min: 10, max: 120, step: 0.5, folder: 'Camera' },
  farFov: { value: 70, min: 10, max: 120, step: 0.5, folder: 'Camera' },
  fovLerp: { value: 8, min: 0.5, max: 30, step: 0.5, folder: 'Camera' },
  rightClickFovOffset: { value: 15, min: 0, max: 60, step: 0.5, folder: 'Camera' },
  defaultYaw: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, folder: 'Camera' },
  defaultPitch: { value: -0.15, min: -1.5, max: 1.5, step: 0.01, folder: 'Camera' },

  shakeMaxNear: { value: 0.5, min: 0, max: 10, step: 0.01, folder: 'Shake' },
  shakeMaxFar: { value: 2.5, min: 0, max: 10, step: 0.01, folder: 'Shake' },
  shakeRampUp: { value: 3, min: 0.1, max: 30, step: 0.1, folder: 'Shake' },
  shakeRampDown: { value: 3, min: 0.1, max: 30, step: 0.1, folder: 'Shake' },
  shakePositionAmount: { value: 0.25, min: 0, max: 1, step: 0.001, folder: 'Shake' },
  shakeRotationAmount: { value: 0.01, min: 0, max: 0.3, step: 0.001, folder: 'Shake' },
  shakeFreqNear: { value: 1.4, min: 0.1, max: 30, step: 0.1, folder: 'Shake' },
  shakeFreqFar: { value: 0.8, min: 0.1, max: 30, step: 0.1, folder: 'Shake' },

  boidCount: { value: 8, min: 1, max: 100, step: 1, folder: 'Flock' },
  neighborRadius: { value: 0.4, min: 0.01, max: 2, step: 0.01, folder: 'Flock' },
  separationRadius: { value: 0.5, min: 0.01, max: 5, step: 0.01, folder: 'Flock' },
  maxSpeed: { value: 0.75, min: 0.05, max: 3, step: 0.05, folder: 'Flock' },
  attractionWeight: { value: 6, min: 0, max: 20, step: 0.05, folder: 'Flock' },
  separationWeight: { value: 8, min: 0, max: 20, step: 0.05, folder: 'Flock' },
  alignmentWeight: { value: 5, min: 0, max: 20, step: 0.05, folder: 'Flock' },
  cohesionWeight: { value: 0.1, min: 0, max: 20, step: 0.05, folder: 'Flock' },

  noiseBase: { value: 0.1, min: 0, max: 10, step: 0.05, folder: 'Noise' },
  noiseVelScale: { value: 0.05, min: 0, max: 5, step: 0.05, folder: 'Noise' },
  noiseFreq1: { value: 6.0, min: 0.1, max: 30, step: 0.1, folder: 'Noise' },
  noiseFreq2: { value: 13.0, min: 0.1, max: 30, step: 0.1, folder: 'Noise' },
  adherenceNoiseAmount: { value: 0.6, min: 0, max: 1, step: 0.01, folder: 'Noise' },
  adherenceNoiseFreq: { value: 0.4, min: 0.01, max: 5, step: 0.01, folder: 'Noise' },
  speedNoiseAmount: { value: 0.7, min: 0, max: 1, step: 0.01, folder: 'Noise' },
  speedNoiseFreq: { value: 0.5, min: 0.01, max: 5, step: 0.01, folder: 'Noise' },

  meshSize: { value: 2.5, min: 0.05, max: 10, step: 0.05, folder: 'Appearance' },
  spawnJitter: { value: 0.2, min: 0, max: 10, step: 0.1, folder: 'Appearance' },
  rotationLerp: { value: 25, min: 1, max: 100, step: 0.5, folder: 'Appearance' },

  flapSpeedBase: { value: 1.0, min: 0, max: 10, step: 0.05, folder: 'Appearance' },
  flapSpeedVelScale: { value: 0.5, min: 0, max: 10, step: 0.05, folder: 'Appearance' },

  flapVolume: { value: 0.6, min: 0, max: 2, step: 0.01, folder: 'Audio' },
  flapRefDistance: { value: 0.5, min: 0.05, max: 10, step: 0.05, folder: 'Audio' },
  flapMoveLerp: { value: 4, min: 0.1, max: 30, step: 0.1, folder: 'Audio' },
  flapSineFreq: { value: 1.8, min: 0.05, max: 10, step: 0.05, folder: 'Audio' },
  flapSineDepth: { value: 0.6, min: 0, max: 1, step: 0.01, folder: 'Audio' },
  windVolume: { value: 0.35, min: 0, max: 2, step: 0.01, folder: 'Audio' },
  windLerpSpeed: { value: 3, min: 0.1, max: 30, step: 0.1, folder: 'Audio' },
  windAngularThreshold: { value: 1.5, min: 0.1, max: 10, step: 0.05, folder: 'Audio' },
  windSineFreq: { value: 1.2, min: 0.05, max: 10, step: 0.05, folder: 'Audio' },
  windSineDepth: { value: 0.7, min: 0, max: 1, step: 0.01, folder: 'Audio' },
  ambientVolume: { value: 0.5, min: 0, max: 2, step: 0.01, folder: 'Audio' },
} as const satisfies Record<string, Spec>

type Widen<T> = T extends boolean ? boolean : T extends number ? number : T

export type ButterflyParams = {
  -readonly [K in keyof typeof PARAM_SPECS]: Widen<(typeof PARAM_SPECS)[K]['value']>
}

export const DEFAULT_PARAMS: ButterflyParams = Object.fromEntries(
  Object.entries(PARAM_SPECS).map(([k, s]) => [k, s.value]),
) as ButterflyParams
