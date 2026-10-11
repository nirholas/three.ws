// The three.ws account, publishing and CC0 library shapes shared by the main
// process (electron/main/three-ws-account.ts), the preload bridge and the
// renderer. The API key itself never crosses into the renderer.

export const AVATAR_VISIBILITIES = ['private', 'unlisted', 'public'] as const
export type AvatarVisibility = typeof AVATAR_VISIBILITIES[number]

export interface ThreeWsAccount {
  signedIn:    boolean
  email:       string | null
  displayName: string | null
  username:    string | null
  scope:       string
  keyPrefix:   string | null
  plan:        string | null
}

export interface DeviceLink {
  userCode:        string
  verificationUrl: string
  expiresIn:       number
}

export interface PublishResult {
  id:   string
  name: string
  url:  string
  visibility: string
}

export interface PublishRequest {
  /** A model the local backend serves, as in GenerationJob.outputUrl. */
  outputUrl:    string
  name:         string
  description?: string
  visibility:   AvatarVisibility
  tags?:        string[]
}

export interface LibraryObject {
  name:       string
  label:      string
  url:        string
  thumb:      string | null
  bytes:      number | null
  categories: string[]
  tags:       string[]
  license:    string
  source:     string | null
}

export interface LibraryPage {
  objects: LibraryObject[]
  total:   number
}

/** Every threews:* IPC call answers with this, since errors lose their class across IPC. */
export type ThreeWsResult<T> = { ok: true; value: T } | { ok: false; error: string; code: string }
