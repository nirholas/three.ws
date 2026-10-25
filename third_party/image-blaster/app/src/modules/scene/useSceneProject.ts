import { useCallback, useEffect, useState } from 'react'
import type { WorldSceneProject } from '../../types/world'

export function useSceneProject(slug: string, refreshKey: string, bundledSceneProject?: WorldSceneProject) {
  const [sceneProject, setSceneProject] = useState<WorldSceneProject | undefined>(
    import.meta.env.DEV ? undefined : bundledSceneProject,
  )
  const [ready, setReady] = useState(!import.meta.env.DEV)

  useEffect(() => {
    if (!import.meta.env.DEV) {
      setSceneProject(bundledSceneProject)
      setReady(true)
      return
    }

    let cancelled = false
    setReady(false)
    setSceneProject(undefined)

    fetch(`/__scene-project?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (response.ok) return response.json() as Promise<WorldSceneProject>
        if (response.status === 404) return undefined
        throw new Error(await response.text())
      })
      .then((project) => {
        if (cancelled) return
        setSceneProject(project)
        setReady(true)
      })
      .catch((error) => {
        if (cancelled) return
        console.warn(`Could not read scene project for "${slug}".`, error)
        setSceneProject(undefined)
        setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [bundledSceneProject, refreshKey, slug])

  const updateSceneProject = useCallback((project: WorldSceneProject) => {
    setSceneProject(project)
    setReady(true)
  }, [])

  return { sceneProject, sceneProjectReady: ready, updateSceneProject }
}
