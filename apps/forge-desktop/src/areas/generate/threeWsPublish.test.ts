import test from 'node:test'
import assert from 'node:assert/strict'
import { canPublishToThreeWs, defaultPublishName, parseTags } from './threeWsPublish'

test('workspace and imported GLB meshes are publishable', () => {
  assert.equal(canPublishToThreeWs('/workspace/Default/chair.glb'), true)
  assert.equal(canPublishToThreeWs(`/optimize/serve-file?path=${encodeURIComponent('/home/me/Models/Lamp.GLB')}`), true)
})

test('splats and missing outputs are not publishable', () => {
  assert.equal(canPublishToThreeWs(undefined), false)
  assert.equal(canPublishToThreeWs('/workspace/Default/scan.ply'), false)
  assert.equal(canPublishToThreeWs(`/optimize/serve-file?path=${encodeURIComponent('/tmp/forge_import_1/splat.splat')}`), false)
})

test('default names drop Forge suffixes and ids', () => {
  assert.equal(defaultPublishName('/workspace/Default/red_chair_opt20000.glb'), 'Red chair')
  assert.equal(defaultPublishName('/workspace/Default/lamp_smooth3_xf_1a2b3c4d.glb'), 'Lamp')
  assert.equal(defaultPublishName(`/optimize/serve-file?path=${encodeURIComponent('/tmp/forge_import_x/mesh.glb')}`), 'Forge model')
  assert.equal(defaultPublishName('/workspace/Default/3f9a1c2e4b5d6a7f.glb'), 'Forge model')
  assert.equal(defaultPublishName(undefined), 'Forge model')
})

test('tags parse from a comma list', () => {
  assert.deepEqual(parseTags(' chair, furniture ,,wood '), ['chair', 'furniture', 'wood'])
  assert.deepEqual(parseTags(''), [])
})
