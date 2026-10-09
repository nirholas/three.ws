import { Suspense } from 'react'
import { useNavStore } from '@shared/stores/navStore'
import { ROUTES } from './routes'

export default function Router(): JSX.Element {
  const currentPage = useNavStore((s) => s.currentPage)
  const { component: Page, wrapperClass } = ROUTES[currentPage]

  return (
    <Suspense fallback={null}>
      <div className={wrapperClass}>
        <Page />
      </div>
    </Suspense>
  )
}
