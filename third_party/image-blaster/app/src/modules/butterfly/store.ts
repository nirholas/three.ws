import { create } from 'zustand'
import { DEFAULT_PARAMS, type ButterflyParams } from './params'

interface ButterflyStore extends ButterflyParams {
  setParam: <K extends keyof ButterflyParams>(key: K, value: ButterflyParams[K]) => void
}

export const useButterflyStore = create<ButterflyStore>((set) => ({
  ...DEFAULT_PARAMS,
  setParam: (key, value) => set({ [key]: value } as Partial<ButterflyStore>),
}))

export const getButterflyParams = (): ButterflyParams => {
  const s = useButterflyStore.getState()
  return s
}
