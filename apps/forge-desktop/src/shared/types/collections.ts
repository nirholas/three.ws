import type { GenerationJob } from '@shared/stores/appStore'

export interface Collection {
  id: string
  name: string
  createdAt: number
  jobs: GenerationJob[]
}
