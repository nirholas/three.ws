import assert from 'node:assert/strict'
import test from 'node:test'

import { createElectronApi } from './electron-api.ts'

test('preload exposes scoped workspace library list/read/open methods', async () => {
  const calls: Array<{ channel: string, payload?: unknown }> = []
  const api = createElectronApi({
    invoke: async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      return { success: true, entries: [] }
    },
    send: () => undefined,
    on: () => undefined,
    removeAllListeners: () => undefined,
  }, { setZoomFactor: () => undefined }, { getPathForFile: () => '' })

  await api.workspace.library.list()
  await api.workspace.library.read({
    workspacePath: 'Workflows/checkpoints/hero.landmarks.v1.json',
    sourceWorkspacePath: 'Workflows/checkpoints/hero.glb',
  })
  await api.workspace.library.open({
    workspacePath: 'Workflows/checkpoints/hero.landmarks.v1.json',
    sourceWorkspacePath: 'Workflows/checkpoints/hero.glb',
  })

  assert.deepEqual(calls, [
    { channel: 'workspace:library:list', payload: undefined },
    {
      channel: 'workspace:library:read',
      payload: {
        workspacePath: 'Workflows/checkpoints/hero.landmarks.v1.json',
        sourceWorkspacePath: 'Workflows/checkpoints/hero.glb',
      },
    },
    {
      channel: 'workspace:library:open',
      payload: {
        workspacePath: 'Workflows/checkpoints/hero.landmarks.v1.json',
        sourceWorkspacePath: 'Workflows/checkpoints/hero.glb',
      },
    },
  ])
})

test('preload resolves dropped file paths through Electron webUtils', () => {
  const files: unknown[] = []
  const calls: string[] = []
  const api = createElectronApi({
    invoke: async (channel: string) => {
      calls.push(channel)
      return null
    },
    send: () => undefined,
    on: () => undefined,
    removeAllListeners: () => undefined,
  }, { setZoomFactor: () => undefined }, {
    getPathForFile: (file) => {
      files.push(file)
      return 'C:\\images\\input.png'
    },
  })
  const file = {} as Parameters<typeof api.fs.getPathForFile>[0]

  assert.equal(api.fs.getPathForFile(file), 'C:\\images\\input.png')
  assert.deepEqual(files, [file])
  assert.deepEqual(calls, [])
})
