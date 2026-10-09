import { create } from 'zustand'
import type { DeviceLink, ThreeWsAccount } from '@shared/types/threeWs'

// The three.ws account as the renderer sees it: who is signed in, never the
// key. Settings drives sign-in; the Generate toolbar reads it to gate publish.

type LinkState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'waiting'; link: DeviceLink; startedAt: number }

interface ThreeWsStore {
  account:  ThreeWsAccount | null
  loading:  boolean
  error:    string | null
  link:     LinkState
  refresh:  () => Promise<void>
  startLink: () => Promise<void>
  cancelLink: () => Promise<void>
  signInWithKey: (key: string) => Promise<boolean>
  signOut:  () => Promise<void>
}

let listening = false

export const useThreeWsStore = create<ThreeWsStore>((set, get) => {
  function listen(): void {
    if (listening) return
    listening = true
    window.electron.threews.onLinkResult((result) => {
      if (result.ok) set({ account: result.value, error: null, link: { status: 'idle' } })
      else set({ error: result.error, link: { status: 'idle' } })
    })
  }

  return {
    account: null,
    loading: false,
    error:   null,
    link:    { status: 'idle' },

    refresh: async () => {
      listen()
      set({ loading: true })
      const result = await window.electron.threews.account()
      if (result.ok) set({ account: result.value, loading: false, error: null })
      else set({ loading: false, error: result.error })
    },

    startLink: async () => {
      listen()
      set({ link: { status: 'starting' }, error: null })
      const result = await window.electron.threews.startLink()
      if (result.ok) set({ link: { status: 'waiting', link: result.value, startedAt: Date.now() } })
      else set({ link: { status: 'idle' }, error: result.error })
    },

    cancelLink: async () => {
      await window.electron.threews.cancelLink()
      set({ link: { status: 'idle' } })
    },

    signInWithKey: async (key) => {
      set({ loading: true, error: null })
      const result = await window.electron.threews.signInWithKey(key)
      if (result.ok) {
        set({ account: result.value, loading: false })
        return true
      }
      set({ loading: false, error: result.error })
      return false
    },

    signOut: async () => {
      if (get().link.status !== 'idle') await get().cancelLink()
      const result = await window.electron.threews.signOut()
      if (result.ok) set({ account: result.value, error: null })
      else set({ error: result.error })
    },
  }
})
