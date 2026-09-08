# Awesome 3D Agents [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> Everything you need to give an AI agent a body.

A curated list of the models, engines, formats, and research that turn a language model into something you can see, animate, talk to, and put on a web page. Generation, rigging, motion, faces, voice, renderers, and the agent frameworks that drive them.

152 entries across 15 sections. Browsable, searchable, and filterable at [three.ws/awesome](https://three.ws/awesome). Every link is fetched and verified before it ships.

## Contents

- [Text and image to 3D](#text-and-image-to-3d) (16)
- [Photos and video to 3D](#photos-and-video-to-3d) (14)
- [Avatars and characters](#avatars-and-characters) (13)
- [Rigging and retargeting](#rigging-and-retargeting) (8)
- [Motion and animation](#motion-and-animation) (10)
- [Texturing and materials](#texturing-and-materials) (5)
- [Faces, lipsync, and voice](#faces-lipsync-and-voice) (15)
- [Rendering on the web](#rendering-on-the-web) (12)
- [Formats and asset pipeline](#formats-and-asset-pipeline) (12)
- [AR and XR](#ar-and-xr) (6)
- [Physics, networking, and shared worlds](#physics-networking-and-shared-worlds) (8)
- [Agent frameworks and protocols](#agent-frameworks-and-protocols) (13)
- [Datasets and simulators](#datasets-and-simulators) (7)
- [Free assets](#free-assets) (6)
- [Learning](#learning) (7)

## Text and image to 3D

Generate a mesh from a prompt or a single photo. This is the front door of the pipeline: the fastest way to get geometry that did not exist an hour ago.

- [TRELLIS](https://github.com/microsoft/TRELLIS) - Structured latent generation that emits meshes, radiance fields, and Gaussians from the same model. Currently the strongest open text and image to 3D quality.
- [Hunyuan3D 2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) - Shape generation plus a separate texture synthesis stage, so the mesh and its material are not fighting for the same capacity. Ships usable PBR maps.
- [TripoSR](https://github.com/VAST-AI-Research/TripoSR) - Single image to 3D in well under a second on one GPU. The reference point for fast feed-forward reconstruction.
- [InstantMesh](https://github.com/TencentARC/InstantMesh) - Multi-view diffusion into a large reconstruction model, tuned for clean topology rather than the blobby output that plagues earlier feed-forward work.
- [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d) - Image to UV-unwrapped, textured mesh in roughly half a second, with material parameter prediction built in.
- [LGM](https://github.com/3DTopia/LGM) - Large multi-view Gaussian model. High-resolution 3D from text or a single image, then converted to a mesh.
- [Wonder3D](https://github.com/xxlong0/Wonder3D) - Cross-domain diffusion that generates consistent normal maps and colour views together, which is why its surfaces hold up under relighting.
- [CRM](https://github.com/thu-ml/CRM) - Convolutional reconstruction model. Single image to a textured mesh in about ten seconds without per-object optimisation.
- [Zero-1-to-3](https://github.com/cvlab-columbia/zero123) - The novel-view-synthesis paper most of this section is built on. Learn what your favourite generator is actually doing by reading this one.
- [threestudio](https://github.com/threestudio-project/threestudio) - One framework, many text-to-3D methods (DreamFusion, Magic3D, ProlificDreamer, and more) behind a shared config system. The right place to compare approaches honestly.
- [Shap-E](https://github.com/openai/shap-e) - Generates implicit functions that render as both meshes and neural radiance fields. Old now, but small, permissive, and easy to run.
- [Point-E](https://github.com/openai/point-e) - Text to point cloud on a single GPU in a minute or two. Still the cheapest way to get rough 3D structure from a prompt.
- [three.ws Forge](https://three.ws/forge) - A free hosted text-to-3D lane with no key and no account. Returns a GLB you can download, embed, or rig.
- [Meshy](https://www.meshy.ai) - Commercial text and image to 3D with quad remeshing and PBR texturing. Good API, generous enough free tier to evaluate properly.
- [Tripo](https://www.tripo3d.ai) - The hosted product from the TripoSR authors. Fast previews, refined high-poly output, and a documented API.
- [Rodin](https://hyper3d.ai) - Generation aimed at production assets: clean topology options, PBR materials, and part-level control.

## Photos and video to 3D

Capture reality instead of inventing it. Photogrammetry, neural fields, and Gaussian splatting, plus the viewers that get the result onto the web.

- [3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting) - The original INRIA implementation that made radiance fields real-time. Everything in this section is downstream of it.
- [gsplat](https://github.com/nerfstudio-project/gsplat) - A CUDA-accelerated splatting library with a clean Python API, faster and far less memory-hungry than the reference code.
- [Nerfstudio](https://github.com/nerfstudio-project/nerfstudio) - A modular pipeline for neural radiance fields and splats, with a real-time web viewer and a sane data-processing story.
- [Spark](https://github.com/sparkjsdev/spark) - A Gaussian splatting renderer that drops into an existing three.js scene as ordinary objects, so splats and meshes light and sort together.
- [SuperSplat](https://github.com/playcanvas/supersplat) - A browser-based editor for cleaning, cropping, and compressing splat captures before you publish them.
- [Brush](https://github.com/ArthurBrussee/brush) - A splatting engine in Rust and wgpu that trains and renders on the web, macOS, Linux, Windows, and Android from one codebase.
- [OpenSplat](https://github.com/WebODM/OpenSplat) - Splat training on CPU as well as CUDA and Metal, which makes it the practical option on machines without an NVIDIA card.
- [COLMAP](https://github.com/colmap/colmap) - Structure from motion and multi-view stereo. The camera poses almost every method above expects as input come from here.
- [DUSt3R](https://github.com/naver/dust3r) - Dense 3D reconstruction from unconstrained image pairs with no camera calibration at all. It quietly deleted a whole preprocessing stage.
- [VGGT](https://github.com/facebookresearch/vggt) - A single feed-forward transformer that predicts camera poses, depth, and point maps together in seconds.
- [Meshroom](https://github.com/alicevision/Meshroom) - A node-graph photogrammetry application on top of AliceVision. The friendliest free path from a folder of photos to a textured mesh.
- [splat](https://github.com/antimatter15/splat) - A WebGL splat viewer in a few hundred readable lines. Read it once and you will understand the whole rendering technique.
- [Luma AI](https://lumalabs.ai) - Phone capture to a shareable splat, with an embed and a web SDK.
- [Polycam](https://poly.cam) - LiDAR and photo capture on phones with mesh, splat, and glTF export. The fastest route from a real object to a file you can use.

## Avatars and characters

Humanoid bodies that arrive already rigged, already skinned, and ready to be driven. Building one from scratch is rarely the right first move.

- [Avaturn](https://avaturn.me) - Photorealistic avatars from a phone photo, exported as GLB or FBX with a standard humanoid skeleton.
- [VRoid Studio](https://vroid.com/en/studio) - A free desktop editor for anime-style VRM characters, with hair, clothing, and expression authoring built in.
- [three-vrm](https://github.com/pixiv/three-vrm) - The VRM runtime for three.js: spring bones, look-at, expressions, and material handling that a plain glTF loader will not give you.
- [VRM specification](https://github.com/vrm-c/vrm-specification) - The glTF extension that standardises humanoid bones, expressions, look-at, and licence metadata. Read it before you invent your own avatar format.
- [MakeHuman](http://www.makehumancommunity.org) - An open parametric human generator with a full skeleton and topology you can actually edit. Old-fashioned, and still unmatched for free anatomically-driven bodies.
- [SMPL-X](https://smpl-x.is.tue.mpg.de) - A parametric body model with articulated hands and an expressive face. The shared coordinate system that most human motion research speaks.
- [Character Creator](https://www.reallusion.com/character-creator/) - Commercial character authoring with production-grade topology, morphs, and direct export to game engines.
- [three.ws Avatar Studio](https://three.ws/avatar-studio) - Generate, rig, dress, and pose an avatar in the browser, then embed it anywhere with one script tag.
- [MetaHuman](https://dev.epicgames.com/documentation/en-us/metahuman/metahuman-documentation) - Epic's photorealistic human creator, free to use, with a browser editor and export into Unreal or Maya. The quality ceiling for a digital human.
- [VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender) - Import, edit, and export VRM avatars in Blender, including spring bones and expressions. The missing link between an authoring tool and the avatar format.
- [PIFuHD](https://github.com/facebookresearch/pifuhd) - Reconstructs a clothed 3D human from one photo at a resolution that captures fabric folds. The paper that made single-image humans plausible.
- [ECON](https://github.com/YuliangXiu/ECON) - Clothed human reconstruction that stays robust on loose garments and unusual poses, where implicit-only methods fall apart.
- [Meshcapade](https://meshcapade.com) - Commercial bodies and motion built on the SMPL family, so what you buy speaks the same parameter space as the research above.

## Rigging and retargeting

A mesh without a skeleton is a statue. This is the layer that decides whether an avatar can be animated at all.

- [Mixamo](https://www.mixamo.com) - Free automatic humanoid rigging plus a large motion-capture library. Its bone naming has become an informal industry convention.
- [UniRig](https://github.com/VAST-AI-Research/UniRig) - An autoregressive model that rigs humans, animals, and objects from one checkpoint, predicting the skeleton and the skin weights together.
- [RigNet](https://github.com/zhan-xu/RigNet) - The neural rigging paper this field grew out of: joint prediction, skeleton connectivity, and skinning learned end to end.
- [AccuRIG](https://actorcore.reallusion.com/auto-rig) - A free desktop auto-rigger for static humanoid meshes, with clean weight painting and direct export to standard skeletons.
- [Rigify](https://docs.blender.org/manual/en/4.5/addons/rigging/rigify/index.html) - Blender's bundled meta-rig system. Free, scriptable, and the practical fallback when an automatic rigger gets a character wrong.
- [SkeletonUtils](https://threejs.org/docs/#examples/en/utils/SkeletonUtils) - Retargeting helpers in three.js that map a clip authored for one skeleton onto another at runtime. Small, unglamorous, and load-bearing.
- [Ossos](https://github.com/sketchpunklabs/ossos) - A TypeScript skeletal animation library with inverse kinematics and retargeting written to be read, not just imported.
- [mixamo_converter](https://github.com/enziop/mixamo_converter) - Batch-converts Mixamo clips to in-place root motion in Blender, which is the conversion every game and web project needs and Mixamo does not do.

## Motion and animation

Generated motion, captured motion, and the datasets both are trained on. A body that only idles is a prop.

- [Motion Diffusion Model](https://github.com/GuyTevet/motion-diffusion-model) - Text to human motion via a lightweight diffusion model. The reference implementation nearly every later method compares against.
- [MoMask](https://github.com/EricGuo5513/momask-codes) - Generative masked modelling of motion tokens. Faster and sharper than diffusion baselines, with editing and in-betweening for free.
- [MotionGPT](https://github.com/OpenMotionLab/MotionGPT) - Treats motion as a language, so one model generates, captions, predicts, and in-betweens with the same interface.
- [T2M-GPT](https://github.com/Mael-zys/T2M-GPT) - VQ-VAE plus a transformer for text-driven motion. A clean, readable codebase to learn the tokenised-motion approach from.
- [OmniControl](https://github.com/neu-vi/OmniControl) - Adds spatial control signals to motion diffusion, so you can pin a hand to a location instead of hoping the prompt lands.
- [HumanML3D](https://github.com/EricGuo5513/HumanML3D) - The text-and-motion dataset behind most of this section. If you are benchmarking, you are benchmarking on this.
- [AMASS](https://amass.is.tue.mpg.de) - Fifteen-plus motion capture datasets unified onto one SMPL body. The reason cross-dataset motion training is possible at all.
- [Cascadeur](https://cascadeur.com) - Keyframe animation software with physics-aware assistance and AutoPosing, usable free for individuals under a revenue threshold.
- [Rokoko](https://www.rokoko.com) - Motion capture suits and a free video-to-motion tool, plus a Blender plugin that handles retargeting.
- [Kalidokit](https://github.com/yeemachine/kalidokit) - Turns MediaPipe face, hand, and pose landmarks into VRM rotations in the browser, so a webcam drives an avatar with no capture suit.

## Texturing and materials

Geometry is half the asset. These are the tools that decide whether it looks like a surface or like grey clay.

- [TEXTure](https://github.com/TEXTurePaper/TEXTurePaper) - Text-guided texturing of an existing mesh through iterative depth-conditioned diffusion. The paper that started this category.
- [Text2Tex](https://github.com/daveredrum/Text2Tex) - Generates high-resolution textures for a mesh from a prompt, with a view-selection pass that reduces the seams these methods usually leave.
- [Paint3D](https://github.com/OpenTexture/Paint3D) - Produces lighting-free texture maps, so the result can be relit properly instead of baking one scene's shadows into the albedo.
- [xatlas](https://github.com/jpcy/xatlas) - Mesh parameterisation and UV atlas generation. A generated mesh with no UVs cannot be textured, and this is what fixes that.
- [Material Maker](https://github.com/RodZill4/material-maker) - A free node-based procedural material authoring tool built on Godot, in the shape of Substance Designer.

## Faces, lipsync, and voice

The difference between a model standing there and an agent talking to you. Speech in, speech out, and a mouth that agrees with the audio.

- [TalkingHead](https://github.com/met4citizen/TalkingHead) - A three.js class that turns a glTF humanoid avatar into a talking head with visemes, gaze, and mood. The most complete open reference for this exact problem.
- [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) - Offline audio to mouth-shape timings as a plain command line tool. No model to host, no API to pay for.
- [MediaPipe](https://github.com/google-ai-edge/mediapipe) - Face landmarks and blendshape coefficients in the browser at video rate, which is enough to drive an avatar's face from a webcam.
- [ARKit blendshapes](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation) - The 52-coefficient facial vocabulary that avatar formats, capture tools, and generators have all standardised on.
- [Whisper](https://github.com/openai/whisper) - Robust multilingual speech recognition that made self-hosted transcription the default rather than the exception.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) - A CTranslate2 reimplementation of Whisper that is several times faster at the same accuracy. Use this in production, not the reference code.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) - Whisper in plain C and C++ with no dependencies, running on phones, browsers via WebAssembly, and Raspberry Pis.
- [Kokoro](https://github.com/hexgrad/kokoro) - An 82M-parameter text to speech model with quality that embarrasses far larger ones, small enough to run in a browser tab.
- [Piper](https://github.com/rhasspy/piper) - Fast local neural text to speech built for low-power devices, with a large set of pretrained voices.
- [F5-TTS](https://github.com/SWivid/F5-TTS) - Flow-matching text to speech with convincing zero-shot voice cloning from a few seconds of reference audio.
- [Coqui TTS](https://github.com/coqui-ai/TTS) - A deep-learning toolkit covering dozens of text to speech and voice-conversion models, including XTTS multilingual cloning.
- [Silero VAD](https://github.com/snakers4/silero-vad) - Voice activity detection in under a millisecond per chunk. The unglamorous component that decides whether a voice agent feels responsive.
- [Pipecat](https://github.com/pipecat-ai/pipecat) - A Python framework for real-time voice and multimodal agents: pipelines, interruption handling, and transport out of the box.
- [LiveKit Agents](https://github.com/livekit/agents) - Build voice agents that join a WebRTC room, with turn detection and telephony handled for you.
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) - Recognition and synthesis already in the browser, with zero bytes shipped. Always check this before adding a model.

## Rendering on the web

The runtime that actually puts the body on a page. Everything above is upstream of a choice made here.

- [three.js](https://github.com/mrdoob/three.js) - The default WebGL and WebGPU library for the web, with the deepest ecosystem of loaders, controls, and examples anywhere.
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber) - A React renderer for three.js. Scene graphs become components, and the reconciler handles the mutation you would otherwise write by hand.
- [drei](https://github.com/pmndrs/drei) - The helper library that makes React Three Fiber practical: controls, loaders, staging, text, and effects you would otherwise rebuild every project.
- [Babylon.js](https://github.com/BabylonJS/Babylon.js) - A batteries-included web engine with a built-in physics layer, node material editor, and an inspector that is genuinely better than the alternatives.
- [PlayCanvas](https://github.com/playcanvas/engine) - A lightweight engine tuned hard for load time and mobile, backed by a collaborative browser editor.
- [model-viewer](https://github.com/google/model-viewer) - One custom element that renders a glTF with sensible defaults, accessibility, and AR on both phone platforms. The lowest-effort correct answer.
- [A-Frame](https://github.com/aframevr/aframe) - Declarative HTML for WebXR scenes, with an entity-component system underneath. Still the shortest path from markup to headset.
- [Threlte](https://github.com/threlte/threlte) - Svelte components for three.js, with a component library, physics bindings, and a preprocessor that keeps bundles small.
- [TresJS](https://github.com/Tresjs/tres) - Vue components for three.js, with reactivity mapped onto scene-graph updates.
- [OGL](https://github.com/oframe/ogl) - A minimal WebGL library that stays close to the API instead of hiding it. The right tool when three.js is more engine than you need.
- [Needle Engine](https://needle.tools) - Author in Unity or Blender, ship a small web build. A pragmatic bridge for teams whose content pipeline already exists.
- [agent-3d](https://github.com/nirholas/three.ws/tree/main/avatar-sdk) - A web component that drops a rigged, animated, lip-syncing agent avatar onto any page in one tag, with a JS API for moods and gestures.

## Formats and asset pipeline

Getting the asset small, valid, and loadable. Most 3D-on-the-web failures are pipeline failures, not rendering failures.

- [glTF](https://github.com/KhronosGroup/glTF) - The transmission format for 3D on the web, plus its extension registry. If you are choosing a format, this is the answer.
- [glTF-Transform](https://github.com/donmccurdy/glTF-Transform) - Read, edit, optimise, and validate glTF from Node or the CLI. Deduplicate, resize textures, weld, and compress in a scripted pipeline.
- [meshoptimizer](https://github.com/zeux/meshoptimizer) - Vertex cache optimisation, simplification, and the meshopt compression that glTF files use. Its gltfpack CLI is the single highest-leverage step in most pipelines.
- [Draco](https://github.com/google/draco) - Geometry compression that shrinks meshes and point clouds hard, with decoders for the browser.
- [KTX-Software](https://github.com/KhronosGroup/KTX-Software) - Basis Universal texture transcoding. GPU-compressed textures that stay compressed in memory, which is usually the real budget problem.
- [glTF-Validator](https://github.com/KhronosGroup/glTF-Validator) - Tells you whether a file is actually valid before a user's browser does. Wire it into CI and stop guessing.
- [glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) - The official test models, including deliberately awkward ones. Your loader is not done until these render correctly.
- [Blender](https://www.blender.org) - Free, scriptable in Python, and headless-capable, which makes it the workhorse of automated 3D pipelines as much as an authoring tool.
- [trimesh](https://github.com/mikedh/trimesh) - The Python library for loading, repairing, measuring, and booleaning meshes. Nearly every 3D backend service has this in it somewhere.
- [Assimp](https://github.com/assimp/assimp) - Imports roughly fifty 3D formats into one data structure. The escape hatch when someone sends you a file nothing else opens.
- [OpenUSD](https://github.com/PixarAnimationStudios/OpenUSD) - Pixar's scene description for large, layered, collaboratively edited worlds. Heavier than glTF, and the right answer above a certain scale.
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) - Bounding volume hierarchies for three.js geometry, turning raycasts against dense meshes from unusable into instant.

## AR and XR

Getting the body off the page and into the room. The web is the only platform where this needs no install.

- [WebXR Device API](https://immersive-web.github.io/webxr/) - The specification behind every headset and phone AR session on the open web. Read the spec, not just a framework's wrapper.
- [WebXR Samples](https://immersive-web.github.io/webxr-samples/) - The working group's own runnable examples, from a bare session to hit testing and layers. Read these before any framework tutorial.
- [Immersive Web Emulator](https://github.com/meta-quest/immersive-web-emulator) - A browser extension that emulates a headset and controllers, so WebXR can be developed and debugged without putting a device on.
- [AR Quick Look](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look) - Apple's system AR viewer. A USDZ behind a link opens full-screen AR on any iPhone with no app and no permission prompt.
- [Scene Viewer](https://developers.google.com/ar/develop/scene-viewer) - The Android equivalent, launched from an intent URL with a glTF. Together with AR Quick Look it is why model-viewer can offer AR everywhere.
- [8th Wall](https://8thwall.org/) - Markerless AR that runs in the mobile browser rather than an app, with world tracking and face effects.

## Physics, networking, and shared worlds

One avatar in a viewer is a demo. Several avatars in a place, with gravity and collisions, is a product.

- [Rapier](https://github.com/dimforge/rapier) - A Rust physics engine with deterministic cross-platform simulation and first-class WebAssembly bindings.
- [Jolt Physics](https://github.com/jrouwe/JoltPhysics) - The multi-core physics engine used in shipped AAA titles, with a WebAssembly build that runs in the browser.
- [cannon-es](https://github.com/pmndrs/cannon-es) - A maintained fork of cannon.js in modern JavaScript. Small and readable, and enough for character controllers and props.
- [Colyseus](https://github.com/colyseus/colyseus) - Authoritative multiplayer rooms with automatic state synchronisation and delta encoding, in Node.
- [Yjs](https://github.com/yjs/yjs) - CRDTs for shared editable state, with providers for WebRTC, WebSocket, and IndexedDB persistence.
- [LiveKit](https://github.com/livekit/livekit) - An open WebRTC server for real-time audio and video, with SDKs everywhere and a self-hostable path.
- [mediasoup](https://github.com/versatica/mediasoup) - A selective forwarding unit as a Node library rather than a service, for teams that want to own the media path.
- [geckos.io](https://github.com/geckosio/geckos.io) - Unreliable UDP-like messaging in the browser over WebRTC data channels, which is what fast-moving avatar positions actually want.

## Agent frameworks and protocols

The mind that drives the body. Listed here because embodiment is a rendering problem bolted onto an agent problem, and most teams underestimate the second one.

- [Model Context Protocol](https://github.com/modelcontextprotocol) - The open protocol for giving a model tools, resources, and prompts from an external server. The cleanest way to let an agent act on a 3D pipeline.
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python) - Build agents on the same harness Claude Code runs on: tool loops, subagents, permissions, and session state.
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) - A small framework for multi-agent handoffs, guardrails, and tracing, with a deliberately thin abstraction layer.
- [LangGraph](https://github.com/langchain-ai/langgraph) - Agents as explicit stateful graphs, with checkpointing and human-in-the-loop pauses. The right shape when a flow must be resumable.
- [Vercel AI SDK](https://github.com/vercel/ai) - One TypeScript interface across model providers, with streaming, structured output, and tool calls that work in the browser.
- [smolagents](https://github.com/huggingface/smolagents) - Agents that write Python to call their tools instead of emitting JSON, in about a thousand lines of library code.
- [CrewAI](https://github.com/crewAIInc/crewAI) - Role-based multi-agent orchestration with an emphasis on readable task delegation.
- [AutoGen](https://github.com/microsoft/autogen) - A research-grade framework for conversational multi-agent systems, with an event-driven core and a visual builder.
- [Mastra](https://github.com/mastra-ai/mastra) - A TypeScript agent framework with workflows, memory, and evals, aimed at shipping rather than research.
- [Letta](https://github.com/letta-ai/letta) - Agents with persistent memory as a first-class server concept, out of the MemGPT research line.
- [A2A](https://github.com/a2aproject/A2A) - An open protocol for agents built by different vendors to discover each other and collaborate over a common envelope.
- [Generative Agents](https://github.com/joonspk-research/generative_agents) - The Stanford simulation where twenty-five agents with memory, reflection, and planning produced emergent social behaviour. Still the clearest demonstration of why memory architecture matters.
- [Voyager](https://github.com/MineDojo/Voyager) - An embodied agent that plays Minecraft by writing and saving its own skills as code, then composing them. The best existing argument for embodiment as a learning signal.

## Datasets and simulators

What the models in this list were trained and evaluated on, and where embodied agents go to practise.

- [Objaverse](https://objaverse.allenai.org) - Around 800,000 annotated 3D objects, and the XL release pushes past ten million. The dataset that made open 3D generation viable.
- [Objaverse-XL](https://github.com/allenai/objaverse-xl) - The download and processing tooling for the ten-million-object release, including deduplication and rendering scripts.
- [ShapeNet](https://huggingface.co/datasets/ShapeNet/ShapeNetCore) - The categorised CAD-model dataset that anchored 3D deep learning for a decade, mirrored on Hugging Face while its original site is unreliable.
- [Habitat](https://github.com/facebookresearch/habitat-lab) - A fast photorealistic simulator for training embodied agents to navigate and manipulate in indoor scenes.
- [AI2-THOR](https://github.com/allenai/ai2thor) - Interactive 3D rooms where objects have state: doors open, eggs break, appliances turn on. Built for agents that change the world rather than tour it.
- [BEHAVIOR](https://behavior.stanford.edu) - A benchmark of a thousand everyday household activities defined in a logic language, with simulated physics and states.
- [ScanNet](http://www.scan-net.org) - Richly annotated RGB-D scans of real indoor spaces, and the benchmark most scene-understanding work still reports on.

## Free assets

Models, textures, and lighting you can ship without a lawyer. Every project in this list looks better with a real HDRI behind it.

- [Poly Haven](https://polyhaven.com) - HDRIs, PBR textures, and models, all CC0, all high quality, with no account required. Start here.
- [ambientCG](https://ambientcg.com) - Thousands of CC0 PBR material sets at multiple resolutions, downloadable in bulk.
- [Kenney](https://kenney.nl) - Tens of thousands of CC0 game assets, including clean low-poly 3D kits that prototype beautifully.
- [Quaternius](https://quaternius.com) - Stylised CC0 model packs with consistent proportions across sets, so a scene assembled from several packs still looks intentional.
- [Sketchfab](https://sketchfab.com) - The largest 3D model library on the web, with a downloadable Creative Commons subset and glTF export.
- [OpenGameArt](https://opengameart.org) - A long-running community archive of openly licensed art. Uneven, and it holds things that exist nowhere else.

## Learning

How to get good at this. Read in roughly this order.

- [three.js manual](https://threejs.org/manual/) - The official guide, rewritten around real problems rather than API surface. The fastest correct start.
- [Discover three.js](https://discoverthreejs.com) - A free book that teaches the concepts underneath the library, including colour management and performance work most tutorials skip.
- [Three.js Journey](https://threejs-journey.com) - Bruno Simon's paid course, and the most thorough path from nothing to shaders and production scenes.
- [The Book of Shaders](https://thebookofshaders.com) - An interactive introduction to fragment shaders. Work through it once and materials stop being magic.
- [WebGL Fundamentals](https://webglfundamentals.org) - What every abstraction in this list is hiding, explained from first principles with runnable examples.
- [WebGPU Fundamentals](https://webgpufundamentals.org) - The same treatment for WebGPU, which is where the web's rendering stack is heading.
- [Real-Time Rendering resources](https://www.realtimerendering.com) - The companion site to the standard reference text, with a maintained portal into graphics literature.

## Contributing

Additions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: entries live in [`data/awesome.json`](../data/awesome.json), not in this file, which is generated. The list is published under Apache-2.0, and each linked project carries its own license.
