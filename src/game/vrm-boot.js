// Side-effect module: wires pixiv/three-vrm (MIT) in as the reference VRM
// implementation for every GLTFLoader in the app that calls installVrmPlugin().
// Import this once, for its side effect only, from each entry point that loads
// avatars or props (src/game/avatar-rig.js covers /play; other entry points
// import it directly). Keeping the registration here, instead of inside
// src/game/vrm-loader.js itself, keeps that module importable on its own with
// no real dependency, which is what tests/vrm-loader.test.js relies on.
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { setVrmPluginFactory } from './vrm-loader.js';

setVrmPluginFactory((parser) => new VRMLoaderPlugin(parser), { VRMUtils });
