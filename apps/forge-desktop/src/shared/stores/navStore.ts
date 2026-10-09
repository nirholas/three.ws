import { create } from 'zustand'

export type Page = 'generate' | 'workflows' | 'models' | 'settings'

interface NavState {
  currentPage: Page
  extensionToOpen: string | null
  navigate: (page: Page) => void
  openExtension: (extensionId: string) => void
  clearExtensionToOpen: () => void
}

export const useNavStore = create<NavState>((set) => ({
  currentPage: 'generate',
  extensionToOpen: null,
  navigate: (page) => set({ currentPage: page }),
  openExtension: (extensionId) => set({ currentPage: 'models', extensionToOpen: extensionId }),
  clearExtensionToOpen: () => set({ extensionToOpen: null }),
}))
