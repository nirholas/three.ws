# Awesome Embodied Agents

> A curated, community-fed directory of the tools, models, runtimes and platforms that give AI agents a face, a voice and a body.

AI agents are moving off the text box. They talk through animated avatars, lip-sync in real time, walk around game worlds and show up as digital humans in your browser. The pieces that make this work are scattered across research repos, game engines, avatar formats and hosted APIs. This list puts them in one place, organized by what you are trying to build.

Everything here is a real, linked project, stored as plain JSON in [`data/entries.json`](data/entries.json) so it is easy to review, diff, search and reuse.

## Add your project

Pull requests are the front door. Add one object to `data/entries.json`, run `node scripts/validate.mjs`, run `node scripts/build-readme.mjs`, and open a PR. The full steps and field rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Prefer not to edit JSON? [Open an issue](.github/ISSUE_TEMPLATE/add-project.md) and a maintainer will add it for you.

## Categories

<!-- INDEX:START -->

- [AI Avatars and Digital Human Frameworks](#ai-avatars-and-digital-human-frameworks) (9)
- [Digital Human Platforms and APIs](#digital-human-platforms-and-apis) (6)
- [Realtime Voice and Video Agent Infrastructure](#realtime-voice-and-video-agent-infrastructure) (2)
- [Web 3D Runtimes](#web-3d-runtimes) (5)
- [VRM and glTF Tooling](#vrm-and-gltf-tooling) (8)
- [Lip-Sync and Facial Animation](#lip-sync-and-facial-animation) (12)
- [Avatar and Character Creators](#avatar-and-character-creators) (10)
- [Rigging, Retargeting and Motion](#rigging-retargeting-and-motion) (7)
- [Performance Capture and VTubing](#performance-capture-and-vtubing) (10)
- [Agents in 3D Worlds](#agents-in-3d-worlds) (9)

<!-- INDEX:END -->

## Projects

Each table is sorted alphabetically. Status is `active` (maintained), `early` (new or experimental) or `archived` (stable reference, no longer updated).

<!-- ENTRIES:START -->

### AI Avatars and Digital Human Frameworks

Open-source frameworks and apps that give an AI agent a face, a voice and a body you can talk to.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [AIAvatarKit](https://github.com/uezo/aiavatarkit) | Framework for quickly building conversational AI avatar applications. | [repo](https://github.com/uezo/aiavatarkit) | active |
| [Amica](https://github.com/semperai/amica) | Open-source interface for interactive communication with 3D characters using voice synthesis and speech recognition. | [repo](https://github.com/semperai/amica) | active |
| [ChatdollKit](https://github.com/uezo/ChatdollKit) | Unity SDK for building voice-enabled chatbots around 3D character models, with lip-sync, expressions and animations. | [repo](https://github.com/uezo/ChatdollKit) | active |
| [LiveTalking](https://github.com/lipku/LiveTalking) | Real-time interactive streaming digital human with speech-driven lip-sync and WebRTC output. | [repo](https://github.com/lipku/LiveTalking) | active |
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | Talk to any LLM with hands-free voice, interruption and a Live2D avatar, running locally across platforms. | [repo](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | active |
| [OpenAvatarChat](https://github.com/HumanAIGC-Engineering/OpenAvatarChat) | Modular implementation of an interactive digital human conversation pipeline. | [repo](https://github.com/HumanAIGC-Engineering/OpenAvatarChat) | active |
| [Project AIRI](https://github.com/moeru-ai/airi) | Self-hosted AI companion and VTuber project with web-based Live2D and VRM avatars and voice chat. | [repo](https://github.com/moeru-ai/airi) | active |
| [TalkingHead](https://github.com/met4citizen/TalkingHead) | JavaScript class for real-time lip-sync talking avatars in the browser using three.js and full-body GLB avatars. | [repo](https://github.com/met4citizen/TalkingHead) | active |
| [three.ws](https://three.ws) | Platform for creating embodied AI agents with 3D avatars, embeddable on any site with the agent-3d web component. |  | active |

### Digital Human Platforms and APIs

Hosted services for conversational avatars, interactive video agents and AI characters.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Anam](https://anam.ai) | API for building real-time, low-latency interactive AI avatars for support, training and sales. |  | active |
| [Convai](https://www.convai.com) | Conversational AI service for games, XR and the metaverse that brings 3D characters to life. |  | active |
| [Simli](https://www.simli.com) | End-to-end API for generating real-time video conversations with AI avatars. |  | active |
| [Soul Machines](https://www.soulmachines.com) | Platform for deploying lifelike digital workers and AI agents with animated digital faces. |  | active |
| [Synthesia](https://www.synthesia.io) | AI video platform that generates presenter-led videos with AI avatars in over 140 languages. |  | active |
| [Tavus](https://www.tavus.io) | API and no-code builder for real-time, face-to-face interactive AI video agents that see, hear and respond. |  | active |

### Realtime Voice and Video Agent Infrastructure

Frameworks that stream speech, video and avatar output between users and agents with low latency.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [LiveKit Agents](https://github.com/livekit/agents) | Framework for building realtime voice and video AI agents that join LiveKit rooms. | [repo](https://github.com/livekit/agents) | active |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | Open-source framework for voice agents, multimodal apps and realtime AI, maintained by Daily and the community. | [repo](https://github.com/pipecat-ai/pipecat) | active |

### Web 3D Runtimes

Engines and component libraries that render and animate characters in the browser.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Babylon.js](https://www.babylonjs.com) | Powerful, beautiful, simple and open web rendering engine with glTF, skeletal animation and WebXR support. | [repo](https://github.com/BabylonJS/Babylon.js) | active |
| [drei](https://github.com/pmndrs/drei) | Collection of helpers and abstractions for React Three Fiber, including model loaders, controls and animation hooks. | [repo](https://github.com/pmndrs/drei) | active |
| [model-viewer](https://modelviewer.dev) | Web component for displaying interactive 3D glTF models with animation and AR on the web. | [repo](https://github.com/google/model-viewer) | active |
| [React Three Fiber](https://github.com/pmndrs/react-three-fiber) | React renderer for three.js that builds 3D scenes declaratively with components and hooks. | [repo](https://github.com/pmndrs/react-three-fiber) | active |
| [three.js](https://threejs.org) | JavaScript 3D library that renders scenes, skinned characters and glTF models in the browser with WebGL and WebGPU. | [repo](https://github.com/mrdoob/three.js) | active |

### VRM and glTF Tooling

Specifications, loaders, importers and optimizers for portable avatar and model formats.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [glTF](https://www.khronos.org/gltf/) | Khronos specification for the open royalty-free 3D asset transmission format used by most web avatars. | [repo](https://github.com/KhronosGroup/glTF) | active |
| [glTF Transform](https://gltf-transform.dev) | JavaScript SDK and CLI to read, edit, optimize and compress glTF 3D models. | [repo](https://github.com/donmccurdy/glTF-Transform) | active |
| [godot-vrm](https://github.com/V-Sekai/godot-vrm) | Godot Engine extension that imports and runs VRM avatars at runtime and in the editor. | [repo](https://github.com/V-Sekai/godot-vrm) | active |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) | Mesh optimization and compression library that includes the gltfpack tool for shrinking glTF avatars. | [repo](https://github.com/zeux/meshoptimizer) | active |
| [three-vrm](https://github.com/pixiv/three-vrm) | three.js library from pixiv for loading, rendering and animating VRM avatars, including expressions and spring bones. | [repo](https://github.com/pixiv/three-vrm) | active |
| [UniVRM](https://github.com/vrm-c/UniVRM) | Unity package for importing, exporting and runtime loading of VRM avatar files. | [repo](https://github.com/vrm-c/UniVRM) | active |
| [VRM Add-on for Blender](https://vrm-addon-for-blender.info) | Blender add-on to import, export and edit VRM humanoid avatar files. | [repo](https://github.com/saturday06/VRM-Addon-for-Blender) | active |
| [VRM Specification](https://github.com/vrm-c/vrm-specification) | Official specification and glTF extensions for the VRM 3D humanoid avatar format. | [repo](https://github.com/vrm-c/vrm-specification) | active |

### Lip-Sync and Facial Animation

Audio-driven and video-driven face animation, visemes, blendshapes and talking-head models.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [EchoMimic](https://github.com/antgroup/echomimic) | Audio-driven portrait animation model from Ant Group that produces lifelike talking-head video. | [repo](https://github.com/antgroup/echomimic) | active |
| [FaceFormer](https://github.com/EvelynFan/FaceFormer) | CVPR 2022 transformer model for speech-driven 3D facial animation. | [repo](https://github.com/EvelynFan/FaceFormer) | active |
| [Hallo](https://github.com/fudan-generative-vision/hallo) | Hierarchical audio-driven visual synthesis model for portrait image animation from Fudan University. | [repo](https://github.com/fudan-generative-vision/hallo) | active |
| [HeadTTS](https://github.com/met4citizen/HeadTTS) | Free neural text-to-speech for browser and Node.js that returns audio with word timestamps and visemes. | [repo](https://github.com/met4citizen/HeadTTS) | active |
| [LivePortrait](https://github.com/KlingAIResearch/LivePortrait) | Efficient portrait animation model with stitching and retargeting control. | [repo](https://github.com/KlingAIResearch/LivePortrait) | active |
| [MediaPipe](https://ai.google.dev/edge/mediapipe) | Google on-device ML framework with face landmark and blendshape tasks for driving avatars from a camera. | [repo](https://github.com/google-ai-edge/mediapipe) | active |
| [MuseTalk](https://github.com/TMElyralab/MuseTalk) | Real-time, high-quality lip synchronization using latent space inpainting. | [repo](https://github.com/TMElyralab/MuseTalk) | active |
| [NVIDIA Audio2Face-3D](https://github.com/NVIDIA/Audio2Face-3D) | NVIDIA SDK and tools that generate facial animation from audio for 3D characters. | [repo](https://github.com/NVIDIA/Audio2Face-3D) | active |
| [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) | Command-line tool that analyzes recorded speech and outputs mouth shape cues for 2D and 3D animation. | [repo](https://github.com/DanielSWolf/rhubarb-lip-sync) | active |
| [SadTalker](https://github.com/OpenTalker/SadTalker) | CVPR 2023 model that turns a single portrait image and audio into a stylized talking-head video. | [repo](https://github.com/OpenTalker/SadTalker) | active |
| [uLipSync](https://github.com/hecomi/uLipSync) | MFCC-based lip-sync plugin for Unity that runs on audio input in real time. | [repo](https://github.com/hecomi/uLipSync) | active |
| [Wav2Lip](https://github.com/Rudrabha/Wav2Lip) | Research code that lip-syncs a face in video to any target speech audio. | [repo](https://github.com/Rudrabha/Wav2Lip) | active |

### Avatar and Character Creators

Tools and models that build 3D characters from sliders, photos, images or text.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Avaturn](https://avaturn.me) | Creates a realistic 3D avatar from a selfie, exports a 3D model and offers an SDK for apps. |  | active |
| [Character Creator](https://www.reallusion.com/character-creator/) | Reallusion tool for building rigged 3D characters with morphs, with Unreal, Unity and Blender integration. |  | active |
| [GaussianAvatars](https://github.com/ShenhanQian/GaussianAvatars) | CVPR 2024 method for photorealistic head avatars built from rigged 3D Gaussians. | [repo](https://github.com/ShenhanQian/GaussianAvatars) | active |
| [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | High-resolution 3D asset generation with large-scale Hunyuan3D diffusion models from Tencent. | [repo](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | active |
| [LAM](https://github.com/aigc3d/LAM) | SIGGRAPH 2025 Large Avatar Model for one-shot, animatable Gaussian head avatars. | [repo](https://github.com/aigc3d/LAM) | active |
| [MakeHuman](https://github.com/makehumancommunity/makehuman) | Open-source tool for modeling parametric 3D humanoid characters. | [repo](https://github.com/makehumancommunity/makehuman) | active |
| [Meshcapade](https://meshcapade.com) | Foundation models that teach AI to see, understand and move, built around 3D human body and motion. |  | active |
| [MPFB2](https://github.com/makehumancommunity/mpfb2) | Blender add-on that brings the MakeHuman human generator into Blender as a native character creator. | [repo](https://github.com/makehumancommunity/mpfb2) | active |
| [TRELLIS](https://github.com/microsoft/TRELLIS) | Microsoft structured 3D latents model for generating 3D assets from text or images. | [repo](https://github.com/microsoft/TRELLIS) | active |
| [VRoid Studio](https://vroid.com/en/studio) | Free application from pixiv for creating 3D anime-style humanoid avatars that export to VRM. |  | active |

### Rigging, Retargeting and Motion

Auto-rigging, body models and motion generation for animating characters.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Animated Drawings](https://github.com/facebookresearch/AnimatedDrawings) | Meta research code that animates children's drawings of human figures. | [repo](https://github.com/facebookresearch/AnimatedDrawings) | archived |
| [Human Motion Diffusion Model](https://github.com/GuyTevet/motion-diffusion-model) | Official PyTorch implementation of the Human Motion Diffusion Model paper. | [repo](https://github.com/GuyTevet/motion-diffusion-model) | active |
| [Mixamo](https://www.mixamo.com) | Adobe service that auto-rigs humanoid 3D characters and offers a large library of motion clips. |  | active |
| [MotionGPT](https://github.com/OpenMotionLab/MotionGPT) | NeurIPS 2023 model that treats human motion as a foreign language for unified motion-language generation. | [repo](https://github.com/OpenMotionLab/MotionGPT) | active |
| [RigNet](https://github.com/zhan-xu/RigNet) | SIGGRAPH 2020 neural rigging for articulated characters. | [repo](https://github.com/zhan-xu/RigNet) | archived |
| [SMPL-X](https://github.com/vchoutas/smplx) | PyTorch implementation of the SMPL, SMPL-H and SMPL-X expressive parametric human body models. | [repo](https://github.com/vchoutas/smplx) | active |
| [UniRig](https://github.com/VAST-AI-Research/UniRig) | Automatic skeleton and skinning-weight prediction for diverse 3D models. | [repo](https://github.com/VAST-AI-Research/UniRig) | active |

### Performance Capture and VTubing

Webcam and sensor tracking, Live2D and 3D puppeteering software for driving avatars live.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [FreeMoCap](https://github.com/freemocap/freemocap) | Free, open-source markerless motion capture system built for everyone. | [repo](https://github.com/freemocap/freemocap) | active |
| [Inochi2D](https://github.com/Inochi2D/inochi2d) | Open-source 2D puppet animation framework and SDK for bringing characters to life. | [repo](https://github.com/Inochi2D/inochi2d) | active |
| [Kalidokit](https://github.com/yeemachine/kalidokit) | Blendshape and kinematics solver for MediaPipe face, pose and hand tracking that drives VRM and Live2D models. | [repo](https://github.com/yeemachine/kalidokit) | active |
| [Live2D Cubism](https://www.live2d.com) | Industry-standard tool and SDKs for real-time 2D character animation used in games and VTubing. |  | active |
| [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) | PixiJS plugin to display and interact with Live2D models in the browser. | [repo](https://github.com/guansss/pixi-live2d-display) | active |
| [VMagicMirror](https://github.com/malaybaku/VMagicMirror) | Windows VRM software that moves an avatar with minimal devices. | [repo](https://github.com/malaybaku/VMagicMirror) | active |
| [VSeeFace](https://www.vseeface.icu) | Free VTuber application that animates 3D VRM avatars from webcam tracking. |  | active |
| [VTube Studio](https://github.com/DenchiSoft/VTubeStudio) | Live2D VTuber app whose public API lets external plugins and agents control models. | [repo](https://github.com/DenchiSoft/VTubeStudio) | active |
| [Warudo](https://warudo.app) | 3D VTubing software with face and hand tracking, custom 3D assets, streaming integrations and a blueprint system. |  | active |
| [XR Animator](https://github.com/ButzYung/SystemAnimatorOnline) | AI-based full-body motion capture and extended reality solution powered by System Animator Online. | [repo](https://github.com/ButzYung/SystemAnimatorOnline) | active |

### Agents in 3D Worlds

Simulators, game environments and frameworks where agents perceive and act inside 3D spaces.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [AI Town](https://github.com/a16z-infra/ai-town) | MIT-licensed starter kit for a virtual town where AI characters live, chat and socialize. | [repo](https://github.com/a16z-infra/ai-town) | active |
| [AI2-THOR](https://github.com/allenai/ai2thor) | Open-source platform for visual AI with interactive 3D household environments. | [repo](https://github.com/allenai/ai2thor) | active |
| [Generative Agents](https://github.com/joonspk-research/generative_agents) | Code for the Stanford paper on interactive simulacra of human behavior in a sandbox town. | [repo](https://github.com/joonspk-research/generative_agents) | archived |
| [Genesis](https://github.com/Genesis-Embodied-AI/Genesis) | Generative physics engine and simulation platform for robotics and embodied AI. | [repo](https://github.com/Genesis-Embodied-AI/Genesis) | active |
| [Habitat-Lab](https://github.com/facebookresearch/habitat-lab) | Modular high-level library to train embodied AI agents across tasks and simulated 3D environments. | [repo](https://github.com/facebookresearch/habitat-lab) | active |
| [Mindcraft](https://github.com/kolbytn/mindcraft) | Minecraft agents driven by large language models, built on Mineflayer. | [repo](https://github.com/kolbytn/mindcraft) | active |
| [Mineflayer](https://github.com/PrismarineJS/mineflayer) | JavaScript API for creating Minecraft bots that perceive and act in the world. | [repo](https://github.com/PrismarineJS/mineflayer) | active |
| [Unity ML-Agents](https://github.com/Unity-Technologies/ml-agents) | Unity toolkit that turns games and simulations into environments for training intelligent agents. | [repo](https://github.com/Unity-Technologies/ml-agents) | active |
| [Voyager](https://github.com/MineDojo/Voyager) | Open-ended embodied agent in Minecraft driven by large language models. | [repo](https://github.com/MineDojo/Voyager) | archived |

<!-- ENTRIES:END -->

## Use the data

The whole directory is machine-readable:

- [`data/entries.json`](data/entries.json): every project with category, status and source link.
- [`data/categories.json`](data/categories.json): the ordered category list.
- [`data/schema.json`](data/schema.json): JSON Schema for entries.

Fork it, build a site on it, or feed it to your agent. No attribution is required.

## Scripts

- `node scripts/validate.mjs` checks required fields, unique ids, valid URLs, categories, description length, dash characters and sort order.
- `node scripts/build-readme.mjs` regenerates the index and tables in this README from the JSON.

Both are dependency-free and need Node 18 or newer.

## License

[CC0 1.0 Universal](LICENSE). To the extent possible under law, the contributors have waived all copyright and related rights to this directory. Listed projects keep their own licenses and trademarks.
