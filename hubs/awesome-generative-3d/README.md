# Awesome Generative 3D

A curated, community-fed directory of everything you need to generate, capture, rig, texture, clean up and ship 3D with AI: open-weight text-to-3D and image-to-3D models, hosted APIs, Gaussian splatting and NeRF tooling, auto-rigging, mesh processing, datasets and glTF pipeline tools.

Every entry lives in one machine-readable file, [`data/entries.json`](data/entries.json). The tables below are generated from it, so the list, the JSON and any tool that consumes them always agree.

**Want your project here? [Read CONTRIBUTING.md](CONTRIBUTING.md) and open a pull request.** It takes one JSON object.

## Categories

<!-- INDEX:START -->
- [Open Text and Image to 3D Models](#open-text-and-image-to-3d-models) (16)
- [Text-to-3D Optimization Frameworks](#text-to-3d-optimization-frameworks) (4)
- [Multi-View Diffusion](#multi-view-diffusion) (5)
- [Hosted Generators and APIs](#hosted-generators-and-apis) (8)
- [Gaussian Splatting and NeRF](#gaussian-splatting-and-nerf) (14)
- [Splat Viewers and Editors](#splat-viewers-and-editors) (6)
- [Auto-Rigging and Animation](#auto-rigging-and-animation) (4)
- [Texture and Materials](#texture-and-materials) (2)
- [Mesh Cleanup and Retopology](#mesh-cleanup-and-retopology) (5)
- [Datasets](#datasets) (7)
- [glTF and Pipeline Tooling](#gltf-and-pipeline-tooling) (14)
- [3D Deep Learning Libraries](#3d-deep-learning-libraries) (3)
- [Platforms and Integrations](#platforms-and-integrations) (1)
<!-- INDEX:END -->

## Entries

Entries are sorted alphabetically within each category. License is what the project's repository declares; check the source before depending on it commercially. Status is `active`, `early` or `archived`.

<!-- ENTRIES:START -->

### Open Text and Image to 3D Models

Open-weight feed-forward and latent diffusion models that turn a prompt or a picture into a mesh, Gaussians or a radiance field.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [3DTopia-XL](https://3dtopia.github.io/3DTopia-XL/) | High-quality PBR asset generation through primitive diffusion (CVPR 2025). | [GitHub](https://github.com/3DTopia/3DTopia-XL) | Apache-2.0 | active |
| [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | Tencent high-resolution 3D asset generation with a shape diffusion model and a texture synthesis pipeline. | [GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | Tencent Hunyuan 3D 2.0 Community License | active |
| [Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Tencent image-to-3D system that produces high-fidelity assets with production-ready PBR materials. | [GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Tencent Hunyuan 3D 2.1 Community License | active |
| [Hunyuan3D-Omni](https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni) | Unified framework from Tencent for controllable generation of 3D assets. | [GitHub](https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni) | - | active |
| [InstantMesh](https://github.com/TencentARC/InstantMesh) | Efficient mesh generation from a single image using sparse-view large reconstruction models. | [GitHub](https://github.com/TencentARC/InstantMesh) | Apache-2.0 | active |
| [LGM](https://me.kiui.moe/lgm/) | Large Multi-View Gaussian Model for high-resolution 3D content creation (ECCV 2024). | [GitHub](https://github.com/3DTopia/LGM) | MIT | active |
| [MIDI-3D](https://github.com/VAST-AI-Research/MIDI-3D) | Multi-instance diffusion that generates a composed 3D scene from a single image (CVPR 2025). | [GitHub](https://github.com/VAST-AI-Research/MIDI-3D) | Apache-2.0 | active |
| [Point-E](https://github.com/openai/point-e) | OpenAI point cloud diffusion for 3D model synthesis from text or images. | [GitHub](https://github.com/openai/point-e) | MIT | active |
| [Shap-E](https://github.com/openai/shap-e) | OpenAI model that generates 3D objects conditioned on text or images. | [GitHub](https://github.com/openai/shap-e) | MIT | active |
| [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d) | Stability AI single-image mesh reconstruction with UV unwrapping and illumination disentanglement (SF3D). | [GitHub](https://github.com/Stability-AI/stable-fast-3d) | Stability AI Community License | active |
| [Stable Point-Aware 3D](https://github.com/Stability-AI/stable-point-aware-3d) | Stability AI single-image reconstruction of 3D objects using a point-aware approach (SPAR3D). | [GitHub](https://github.com/Stability-AI/stable-point-aware-3d) | Stability AI Community License | active |
| [TRELLIS](https://trellis3d.github.io) | Microsoft structured 3D latent model that generates Gaussians, radiance fields and meshes from text or images (CVPR 2025). | [GitHub](https://github.com/microsoft/TRELLIS) | MIT | active |
| [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | Microsoft follow-up using native, compact structured latents for 3D generation. | [GitHub](https://github.com/microsoft/TRELLIS.2) | MIT | active |
| [TripoSF](https://github.com/VAST-AI-Research/TripoSF) | SparseFlex representation for high-resolution 3D shape modeling with arbitrary topology. | [GitHub](https://github.com/VAST-AI-Research/TripoSF) | MIT | active |
| [TripoSG](https://github.com/VAST-AI-Research/TripoSG) | High-fidelity 3D shape synthesis built on large-scale rectified flow models. | [GitHub](https://github.com/VAST-AI-Research/TripoSG) | MIT | active |
| [TripoSR](https://github.com/VAST-AI-Research/TripoSR) | Fast feed-forward 3D object reconstruction from a single image. | [GitHub](https://github.com/VAST-AI-Research/TripoSR) | MIT | active |

### Text-to-3D Optimization Frameworks

Score distillation and Gaussian optimization methods and the frameworks that bundle them.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [DreamGaussian](https://dreamgaussian.github.io/) | Generative Gaussian splatting for efficient text-to-3D and image-to-3D content creation (ICLR 2024). | [GitHub](https://github.com/dreamgaussian/dreamgaussian) | MIT | active |
| [GaussianDreamer](https://taoranyi.com/gaussiandreamer/) | Fast text-to-3D Gaussian generation that bridges 2D and 3D diffusion models (CVPR 2024). | [GitHub](https://github.com/hustvl/GaussianDreamer) | Apache-2.0 | active |
| [stable-dreamfusion](https://github.com/ashawkey/stable-dreamfusion) | Text-to-3D and image-to-3D with mesh export, using NeRF and diffusion guidance. | [GitHub](https://github.com/ashawkey/stable-dreamfusion) | Apache-2.0 | active |
| [threestudio](https://github.com/threestudio-project/threestudio) | Unified framework for 3D content generation covering many text-to-3D and image-to-3D methods. | [GitHub](https://github.com/threestudio-project/threestudio) | Apache-2.0 | active |

### Multi-View Diffusion

Models that synthesize consistent views of an object, the front end of many image-to-3D pipelines.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [MV-Adapter](https://huanngzh.github.io/MV-Adapter-Page/) | Adapter that adds multi-view consistent image generation to existing diffusion models (ICCV 2025). | [GitHub](https://github.com/huanngzh/MV-Adapter) | Apache-2.0 | active |
| [SyncDreamer](https://liuyuan-pal.github.io/SyncDreamer/) | Generates multiview-consistent images from a single-view image (ICLR 2024 Spotlight). | [GitHub](https://github.com/liuyuan-pal/SyncDreamer) | MIT | active |
| [Wonder3D](https://www.xxlong.site/Wonder3D/) | Single image to 3D using cross-domain diffusion over normal maps and color images. | [GitHub](https://github.com/xxlong0/Wonder3D) | MIT | active |
| [Zero-1-to-3](https://zero123.cs.columbia.edu/) | Zero-shot one image to 3D object method that conditions diffusion on camera viewpoint (ICCV 2023). | [GitHub](https://github.com/cvlab-columbia/zero123) | MIT | active |
| [Zero123++](https://github.com/SUDO-AI-3D/zero123plus) | Single image to consistent multi-view diffusion base model. | [GitHub](https://github.com/SUDO-AI-3D/zero123plus) | Apache-2.0 | active |

### Hosted Generators and APIs

Managed services for generating 3D assets from text or images, many with developer APIs.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [3D AI Studio](https://www.3daistudio.com) | AI toolkit that turns text or images into 3D assets. | - | Proprietary | active |
| [Hunyuan3D Creation Platform](https://3d.hunyuan.tencent.com) | Tencent hosted platform for text-to-3D, image-to-3D, 3D animation and texture generation. | - | Proprietary | active |
| [Kaedim](https://www.kaedim3d.com) | AI-powered 3D asset production service for studios and brands. | - | Proprietary | active |
| [Meshy](https://www.meshy.ai) | AI 3D model generator for text and images with export to FBX, OBJ, GLB and STL. | - | Proprietary | active |
| [Rodin by Hyper3D](https://hyper3d.ai) | Hosted 3D generator that produces high-quality, near production-ready 3D assets. | - | Proprietary | active |
| [Scenario](https://www.scenario.com) | Creative production platform that includes 3D alongside image, video and audio pipelines for game assets. | - | Proprietary | active |
| [Sloyd](https://www.sloyd.ai) | 3D generator for text or images aimed at game developers, designers and 3D printing. | - | Proprietary | active |
| [Tripo](https://www.tripo3d.ai) | VAST 3D generation platform with text-to-3D, image-to-3D, rigging and a documented developer API. | - | Proprietary | active |

### Gaussian Splatting and NeRF

Capture, reconstruction and training tools for radiance fields, splats and neural surfaces.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [3D Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) | Original reference implementation of 3D Gaussian Splatting for real-time radiance field rendering. | [GitHub](https://github.com/graphdeco-inria/gaussian-splatting) | Gaussian-Splatting License (Inria and MPII) | active |
| [COLMAP](https://colmap.github.io/) | Structure-from-Motion and Multi-View Stereo pipeline widely used to prepare camera poses for splat and NeRF training. | [GitHub](https://github.com/colmap/colmap) | BSD-3-Clause | active |
| [DUSt3R](https://dust3r.europe.naverlabs.com/) | Geometric 3D vision from image pairs without known camera calibration. | [GitHub](https://github.com/naver/dust3r) | CC-BY-NC-SA-4.0 | active |
| [gaussian-splatting-lightning](https://github.com/yzslab/gaussian-splatting-lightning) | Gaussian splatting framework with many derived algorithms and an interactive web viewer. | [GitHub](https://github.com/yzslab/gaussian-splatting-lightning) | MIT | active |
| [gsplat](https://docs.gsplat.studio/) | CUDA accelerated rasterization library for Gaussian splatting. | [GitHub](https://github.com/nerfstudio-project/gsplat) | Apache-2.0 | active |
| [instant-ngp](https://nvlabs.github.io/instant-ngp) | NVIDIA lightning fast NeRF and neural graphics primitives training. | [GitHub](https://github.com/NVlabs/instant-ngp) | NVIDIA Source Code License | active |
| [KIRI Engine](https://www.kiriengine.app) | 3D scanner app for iOS, Android and web with photogrammetry, Gaussian splatting and 3DGS to mesh. | - | Proprietary | active |
| [Mip-Splatting](https://niujinshuchong.github.io/mip-splatting/) | Alias-free 3D Gaussian Splatting (CVPR 2024 Best Student Paper). | [GitHub](https://github.com/autonomousvision/mip-splatting) | Gaussian-Splatting License (Inria and MPII) | active |
| [nerfacc](https://www.nerfacc.com/) | General NeRF acceleration toolbox in PyTorch. | [GitHub](https://github.com/nerfstudio-project/nerfacc) | MIT | active |
| [nerfstudio](https://docs.nerf.studio) | Collaboration friendly studio for training and viewing NeRFs and Gaussian splats. | [GitHub](https://github.com/nerfstudio-project/nerfstudio) | Apache-2.0 | active |
| [Neuralangelo](https://research.nvidia.com/labs/dir/neuralangelo/) | High-fidelity neural surface reconstruction from multi-view images (CVPR 2023). | [GitHub](https://github.com/NVlabs/neuralangelo) | NVIDIA Source Code License | active |
| [Polycam](https://poly.cam) | 3D scanning and reality capture platform that works from a phone. | - | Proprietary | active |
| [Postshot](https://www.jawset.com) | Jawset desktop software for training radiance fields and Gaussian splats. | - | Proprietary | active |
| [VGGT](https://github.com/facebookresearch/vggt) | Visual Geometry Grounded Transformer for feed-forward 3D scene reconstruction (CVPR 2025 Best Paper). | [GitHub](https://github.com/facebookresearch/vggt) | VGGT License | active |

### Splat Viewers and Editors

Web viewers, editors and converters for Gaussian splat files.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) | Three.js based implementation of 3D Gaussian splatting rendering. | [GitHub](https://github.com/mkkellogg/GaussianSplats3D) | MIT | active |
| [gsplat.js](https://github.com/huggingface/gsplat.js) | JavaScript Gaussian splatting library for the browser. | [GitHub](https://github.com/huggingface/gsplat.js) | MIT | active |
| [splat](https://antimatter15.com/splat/) | WebGL 3D Gaussian splat viewer. | [GitHub](https://github.com/antimatter15/splat) | MIT | active |
| [splat-transform](https://github.com/playcanvas/splat-transform) | CLI tool and library for Gaussian splat processing and format conversion. | [GitHub](https://github.com/playcanvas/splat-transform) | MIT | active |
| [SuperSplat](https://superspl.at/editor) | Open source 3D Gaussian splat editor. | [GitHub](https://github.com/playcanvas/supersplat) | MIT | active |
| [SuperSplat Platform](https://superspl.at) | Site to edit, publish, share, download and browse 3D Gaussian splats. | - | MIT | active |

### Auto-Rigging and Animation

Tools that add skeletons and skin weights to static meshes so they can move.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [AccuRIG](https://www.reallusion.com/auto-rig/accurig/default.html) | Reallusion auto-rigging tool for 3D character models. | - | Proprietary | active |
| [Mixamo](https://www.mixamo.com) | Adobe web service for auto-rigging and animating 3D characters. | - | Proprietary | active |
| [RigNet](https://github.com/zhan-xu/RigNet) | Neural rigging for articulated characters (SIGGRAPH 2020). | [GitHub](https://github.com/zhan-xu/RigNet) | GPL-3.0 | active |
| [UniRig](https://zjp-shadow.github.io/works/UniRig/) | One model that rigs diverse 3D skeletons (SIGGRAPH 2025). | [GitHub](https://github.com/VAST-AI-Research/UniRig) | MIT | active |

### Texture and Materials

Texture synthesis and differentiable rendering tools for generated geometry.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [nvdiffrast](https://nvlabs.github.io/nvdiffrast) | Modular primitives for high-performance differentiable rendering, used in many texture and mesh optimization pipelines. | [GitHub](https://github.com/NVlabs/nvdiffrast) | NVIDIA Source Code License (1-Way Commercial) | active |
| [TEXTure](https://texturepaper.github.io/TEXTurePaper/) | Text-guided texturing of 3D shapes. | [GitHub](https://github.com/TEXTurePaper/TEXTurePaper) | MIT | active |

### Mesh Cleanup and Retopology

Libraries and apps for repairing, decimating, remeshing and converting generated meshes.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [Instant Meshes](https://github.com/wjakob/instant-meshes) | Interactive field-aligned mesh generator for quad-dominant retopology. | [GitHub](https://github.com/wjakob/instant-meshes) | BSD-3-Clause | active |
| [libigl](http://libigl.github.io/libigl/) | C++ geometry processing library. | [GitHub](https://github.com/libigl/libigl) | MPL-2.0 | active |
| [MeshLab](http://www.meshlab.net) | Open source mesh processing system for cleaning, repairing and decimating meshes. | [GitHub](https://github.com/cnr-isti-vclab/meshlab) | GPL-3.0 | active |
| [PyMeshLab](https://github.com/cnr-isti-vclab/PyMeshLab) | Python library exposing MeshLab mesh processing filters. | [GitHub](https://github.com/cnr-isti-vclab/PyMeshLab) | GPL-3.0 | active |
| [trimesh](https://trimesh.org) | Python library for loading and using triangular meshes. | [GitHub](https://github.com/mikedh/trimesh) | MIT | active |

### Datasets

3D object collections used to train and evaluate generative models.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [glTF-Sample-Assets](https://www.khronos.org/gltf/) | Khronos assortment of assets that demonstrate glTF features and capabilities. | [GitHub](https://github.com/KhronosGroup/glTF-Sample-Assets) | - | active |
| [Objaverse](https://objaverse.allenai.org) | Dataset of 800K+ annotated 3D objects widely used to train generative 3D models. | - | Varies per object | active |
| [objaverse-rendering](https://github.com/allenai/objaverse-rendering) | Scripts for rendering Objaverse objects into multi-view training images. | [GitHub](https://github.com/allenai/objaverse-rendering) | Apache-2.0 | active |
| [Objaverse-XL](https://objaverse.allenai.org/) | Universe of 10M+ 3D objects with scripts for downloading and processing. | [GitHub](https://github.com/allenai/objaverse-xl) | Apache-2.0 | active |
| [OmniObject3D](https://github.com/omniobject3d/OmniObject3D) | Large-vocabulary 3D object dataset for realistic perception, reconstruction and generation (CVPR 2023). | [GitHub](https://github.com/omniobject3d/OmniObject3D) | - | active |
| [ShapeNet](https://huggingface.co/ShapeNet) | Large repository of annotated 3D shapes hosted on Hugging Face. | - | - | active |
| [Thingi10K](https://ten-thousand-models.appspot.com/) | Dataset of 10,000 3D printing models. | [GitHub](https://github.com/Thingi10K/Thingi10K) | Apache-2.0 | active |

### glTF and Pipeline Tooling

Specs, optimizers, validators, viewers and DCC integrations that take AI output to production.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [3D Tiles](https://github.com/CesiumGS/3d-tiles) | Specification for streaming massive heterogeneous 3D geospatial datasets. | [GitHub](https://github.com/CesiumGS/3d-tiles) | - | active |
| [Blender MCP (mcp-for-blender)](https://www.mcp-for-blender.com/) | Community plugin that lets any LLM control Blender through the Model Context Protocol. | [GitHub](https://github.com/ahujasid/mcp-for-blender) | MIT | active |
| [BlenderGPT](https://github.com/gd3kr/BlenderGPT) | Control Blender with English commands through OpenAI GPT-4. | [GitHub](https://github.com/gd3kr/BlenderGPT) | MIT | active |
| [Draco](https://google.github.io/draco/) | Library for compressing and decompressing 3D meshes and point clouds. | [GitHub](https://github.com/google/draco) | Apache-2.0 | active |
| [glTF](https://github.com/KhronosGroup/glTF) | Khronos specification for runtime 3D asset delivery. | [GitHub](https://github.com/KhronosGroup/glTF) | - | active |
| [glTF Report](https://gltf.report) | Viewer, analysis tool, script editor and validator for glTF 2.0 models. | - | - | active |
| [glTF-Blender-IO](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html) | Blender glTF 2.0 importer and exporter. | [GitHub](https://github.com/KhronosGroup/glTF-Blender-IO) | Apache-2.0 | active |
| [gltf-pipeline](https://github.com/CesiumGS/gltf-pipeline) | Content pipeline tools for optimizing glTF assets. | [GitHub](https://github.com/CesiumGS/gltf-pipeline) | Apache-2.0 | active |
| [glTF-Transform](https://gltf-transform.dev) | glTF 2.0 SDK for JavaScript and TypeScript on web and Node.js. | [GitHub](https://github.com/donmccurdy/glTF-Transform) | MIT | active |
| [glTF-Validator](https://github.com/KhronosGroup/glTF-Validator) | Tool to validate glTF assets. | [GitHub](https://github.com/KhronosGroup/glTF-Validator) | Apache-2.0 | active |
| [gltfjsx](https://gltf.pmnd.rs) | Turns glTF files into React Three Fiber JSX components. | [GitHub](https://github.com/pmndrs/gltfjsx) | MIT | active |
| [meshoptimizer](https://meshoptimizer.org/) | Mesh optimization library that makes meshes smaller and faster to render, including the gltfpack tool. | [GitHub](https://github.com/zeux/meshoptimizer) | MIT | active |
| [model-viewer](https://modelviewer.dev) | Web component to display interactive 3D models on the web and in AR. | [GitHub](https://github.com/google/model-viewer) | Apache-2.0 | active |
| [three.js](https://threejs.org/) | JavaScript 3D library with first-class glTF loading. | [GitHub](https://github.com/mrdoob/three.js) | MIT | active |

### 3D Deep Learning Libraries

Differentiable geometry and 3D data libraries for building new generative models.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [Kaolin](https://kaolin.readthedocs.io) | PyTorch library for accelerating 3D deep learning research. | [GitHub](https://github.com/NVIDIAGameWorks/kaolin) | Apache-2.0 | active |
| [Open3D](http://www.open3d.org) | Library for 3D data processing. | [GitHub](https://github.com/isl-org/Open3D) | MIT | active |
| [PyTorch3D](https://pytorch3d.org/) | Library of reusable components for deep learning with 3D data. | [GitHub](https://github.com/facebookresearch/pytorch3d) | BSD-3-Clause | active |

### Platforms and Integrations

Products that put generated 3D content to work in applications.

| Project | Description | Repo | License | Status |
| --- | --- | --- | --- | --- |
| [three.ws](https://three.ws) | Platform for embedding animated 3D AI agents on any website with a web component. | - | - | active |

<!-- ENTRIES:END -->

## Use the data

`data/entries.json` is validated against [`data/schema.json`](data/schema.json) and categorized by [`data/categories.json`](data/categories.json). Fetch it directly to power a search page, an agent tool or a dashboard.

```
npm run validate   # check entries.json
npm run build      # regenerate the tables above
```

Both scripts are dependency-free Node (18+) ES modules.

## License

The list and its data are released under [CC0 1.0](LICENSE). Each listed project keeps its own license.
