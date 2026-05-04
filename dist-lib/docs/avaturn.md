# Avaturn Documentation (scraped 2026-04-16)

Source: https://docs.avaturn.me/docs/what-is-avaturn/

---

## 1. Getting Started

**URL:** https://docs.avaturn.me/docs/what-is-avaturn/

Avaturn is a realistic avatar creator and avatar system for games, apps and metaverses. The platform enables developers to delegate avatar generation and customization responsibilities while focusing on their core game experience.

The service allows users to design avatars with customizable elements including body shape, clothing, accessories, hairstyles, footwear, and eyewear. Upon completion, users receive a compiled ready-to-use 3D model that can replace existing characters.

Avaturn supports integration across multiple platforms: Unity, Unreal Engine, HTML + JavaScript (including Three.js), Android, and iOS. The platform offers free integration access via tutorials, with advanced customization available through an API and web SDK accessible through the developer portal.

Users can register at developer.avaturn.me to begin using Avaturn at no cost with no limits on the number of avatars created or number of exports.

---

## 2. Importing

### 2.1 Blender

**URL:** https://docs.avaturn.me/docs/importing/blender/

Straightforward instructions for importing Avaturn avatars into Blender, leveraging the software's native support for GLTF 2.0 format.

Three-Step Import Process:

1. Initiate Import: Access Blender's import function to load your GLB file
2. Configure Settings: When the import dialog appears, set the bone direction parameter to "Blender" before finalizing the import process
3. Completion: Your avatar assets are now ready for use within your Blender project

If the imported avatar appears gray or you're uncertain whether textures have loaded correctly, click a visualization button to verify texture rendering. The process is streamlined due to Blender's robust compatibility with industry-standard GLTF 2.0 specifications.

### 2.2 Unity

**URL:** https://docs.avaturn.me/docs/importing/unity/

Avaturn exports avatars in GLB format, which Unity doesn't natively support. The documentation recommends using the "GLTFast" package to load GLB files either during editing or while the application runs.

Key Recommendations:

- Apply an environment map to prevent metallic clothing from appearing black
- GLTFast version 5.2 was tested, though other versions should work

Alternative Approach (Not Recommended): Users can alternatively convert GLB files to FBX format using Avaturn's conversion tool, then import the FBX directly into Unity. However, this method requires additional manual work—specifically importing metalness maps and adjusting material smoothness settings. This approach is less ideal than using GLTFast.

### 2.3 Unreal Engine

**URL:** https://docs.avaturn.me/docs/importing/unreal/

Two distinct import processes depending on your Unreal Engine version.

For UE 5.1 and newer: The procedure is streamlined since these versions natively support GLB files. Users simply need to drag and drop it onto the content manager to complete the import.

For UE 5.0 and earlier: Since native GLB support is unavailable, the workflow requires additional steps:

1. Download a GLB avatar from Avaturn
2. Convert the file to FBX format using Avaturn's dedicated converter tool, ensuring "Unreal" is selected in the converter settings
3. Import the FBX into the content browser with specific settings:
    - Normals import method set to "Import Normals"
    - Import uniform scale at 100.0 (adjustable based on asset scale)
    - Enable "Invert normal maps"
4. Finalize the process, with occasional manual transparency corrections needed for eyewear elements

### 2.4 Meta Spark Studio

**URL:** https://docs.avaturn.me/docs/importing/spark_studio/

Brief documentation page with reference to a video tutorial contributed by Max Gomes demonstrating the import process for importing avatars into Meta's Spark Studio.

### 2.5 Convert GLB to FBX

**URL:** https://docs.avaturn.me/docs/importing/glb-to-fbx/

Avaturn exports 3D avatars in GLTF 2.0 format to ensure compatibility across different engines. For legacy workflows that require FBX files, Avaturn provides a conversion tool that outputs FBX files with separate texture maps, though materials may require manual adjustment.

Why GLTF 2.0 is Preferred:

- Open standard developed by the Khronos Group (versus Autodesk's proprietary FBX)
- JSON-based structure for readability and easier debugging
- Optimized for real-time rendering in web and VR applications
- Built-in support for Physically-Based Rendering (PBR) materials
- Better interoperability across engines and platforms
- Smaller file sizes with improved compression
- Extensible architecture for custom metadata

Engine-Specific Guidance:

- Unity: Strongly recommends using GLTFast package to load GLB directly, avoiding conversion
- Unreal Engine: Versions 5.1+ support native GLB importing. Older versions requiring FBX need specific import settings: Import Normals method, 100.0 uniform scale, and inverted normal maps enabled

### 2.6 Convert GLB to VRM

**URL:** https://docs.avaturn.me/docs/importing/glb-to-vrm/

Avaturn exports in GLTF 2.0 format to ensure the 3D model looks well in every engine that uses it. VR applications and VTubing software utilize the VRM file format for humanoid avatar data, which is built upon glTF 2.0. This means VRM-compatible software can open glTF 2.0 files, but the reverse compatibility does not apply.

### 2.7 Mixamo Animations

**URL:** https://docs.avaturn.me/docs/importing/mixamo/

While Avaturn exports models in GLB format, Mixamo cannot directly read this format. Converting GLB to FBX may cause issues, so the guide recommends an alternative approach:

Recommended Process:

1. Download a pre-tested Avaturn avatar in FBX format from their assets
2. Import that model into Mixamo and select desired animations
3. Export the animated avatar, choosing "without skin" for Blender or "with skin" for Unity
4. Apply the animation to your avatar

The key insight is that instead of converting your exported avatar, users should work with a Mixamo-compatible FBX template provided by Avaturn, then transfer the animations to their actual avatar model.

---

## 3. Integration

### 3.1 Overview

**URL:** https://docs.avaturn.me/docs/integration/overview/

Avaturn functions as an integrable plugin for applications, games, and metaverse platforms. The workflow is straightforward: users trigger an avatar configurator within a game, customize their avatar, and the game then receives the completed avatar file.

Available SDKs and Integration Options:

- Unity integration
- Unreal Engine support
- HTML and JavaScript implementation
- Three.js framework support
- Android mobile development
- iOS mobile development

Basic integration follows published tutorials at no cost. Developers seeking advanced customization features can access enhanced tools through the API and web SDK, which require registration at the developer portal.

### 3.2 Avatar and Body Types

**URL:** https://docs.avaturn.me/docs/integration/bodies/

Avatar Types:

- **T1 Avatars:** Static faces that provide the most realistic avatar. Cannot use face bones or blendshapes for facial animation.
- **T2 Avatars:** Feature separate eyeballs and mouthhole structures, enabling facial animation through ARKit blendshapes and visemes. Slightly reduced recognizability compared to T1 models.

Body Shape Types: Two body presets are available: v2023 and v2024.

- **v2023:** The original body design iteration with unique skeletons per body shape that vary significantly from each other.
- **v2024:** An improved version with nearly identical skeletons across body shapes. "Skeletons are identical everywhere, but have a bit of stretch/compression of the shoulder joints. Legs, arm length, head bone is the same!" This design makes animation work easier while maintaining shape variety.

Both versions come in Female and Male configurations.

### 3.3 Web Integration - HTML

**URL:** https://docs.avaturn.me/docs/integration/web/html/

Instructions for integrating the Avaturn avatar creation tool into web applications.

Quick Start:

1. Add a div element with the ID `avaturn-sdk-container` to your HTML markup.
2. Include a module script that imports the AvaturnSDK from a CDN. Initialize the SDK with your custom subdomain and set up an event listener for the export event.

Key Configuration Details:

- **Subdomain Setup:** Create a project and obtain your own subdomain through developer.avaturn.me rather than using the limited "demo" subdomain.
- **Export Callback:** The SDK triggers an "export" event when users click the "Next" button, returning the generated avatar data for processing.
- **Styling Options:** CSS can be applied to the container element, with optional custom class names for the internal iframe.

Additional Resources: Complete SDK reference guide, plain HTML CodeSandbox example, React component examples, and package manager installation via npm (`@avaturn/sdk`).

### 3.4 Web Integration - Three.js

**URL:** https://docs.avaturn.me/docs/integration/web/threejs/

Integration overview for using Avaturn with Three.js. The platform functions by opening an iframe through which users can create avatars, which are then sent as GLB files to the Three.js app for rendering using GLTFLoader.

Developers are directed to a starter project available on GitHub at the `avaturn-threejs-example` repository. The documentation specifically mentions the `initAvaturn` function, which requires customization.

Required Configuration: Replace the demo subdomain with your own, created through the developer portal at developer.avaturn.me.

### 3.5 Web SDK - Introduction

**URL:** https://docs.avaturn.me/docs/integration/web/sdk/introduction/

Key Features:

- Receive callbacks on user actions (garment change, body change, export)
- Customize the list of assets available for a particular user
- Create custom UI for the avatar editor through programmatic asset switching

Prerequisites and Installation:

- Create a project at the developer portal and activate API access
- Install via npm: `npm install @avaturn/sdk`

Basic Implementation: Obtain a session link from the `/v1/sessions/new` API endpoint and initialize the SDK. Pass a DOM container to `sdk.init(...)`, which handles iframe creation. Optional parameters include custom CSS class names for the iframe.

**Important:** "Avaturn web SDK only works in conjunction with Avaturn API and is only available in the paid package."

### 3.6 Web SDK - Using Callbacks

**URL:** https://docs.avaturn.me/docs/integration/web/sdk/callbacks/

The Avaturn Web SDK enables developers to implement callbacks that respond to user interactions:

- Asset changed
- Body changed
- Avatar exported

Implementation: Obtain a URL using the `/v1/sessions/new` API request, then pass it to the SDK initialization function.

```js
const scene = await sdk.init(container, {
	url: '<URL_RETURNED_BY_AVATURN_API>',
	iframeClassName: '<CSS_CLASS_NAME_FOR_IFRAME>',
	disableUi: false,
});
```

After initialization, attach event listeners using the `.on()` method to execute custom actions based on user interactions.

### 3.7 Web SDK - Implementing Custom UI

**URL:** https://docs.avaturn.me/docs/integration/web/sdk/custom-ui/

To disable Avaturn's default interface, pass `disableUi=true` to the initialization function.

Once disabled, the SDK provides access to asset and body data through specific methods. Developers can retrieve available options by calling methods that return lists of bodies and assets when the system is ready. Activate specific asset or body using dedicated setter functions that accept an ID parameter.

**Important Limitation:** In custom UI mode, developers will only receive the `'load'` callback event. Other callback functions that normally fire during user interactions will not trigger when using `disableUi` mode.

### 3.8 Unity Integration

**URL:** https://docs.avaturn.me/docs/integration/unity/

Supported Platforms: WebGL and Android/iOS integrations. Windows/Mac Standalone apps possible but require contacting the company directly.

Available Resources:

- Integration tutorial explaining how to add Avaturn to games
- SDK and sample code available on GitHub, supporting Android, iOS, and WebGL
- WebGL demo showcasing runtime avatar replacement
- WebGL demo featuring a third-person controller implementation

### 3.9 Unreal Engine Integration

**URL:** https://docs.avaturn.me/docs/integration/unreal/

Introduction to Avaturn integration for Unreal Engine 5.0 and later. Two SDK options:

1. Web-view based SDK — a browser-integrated approach
2. Native SDK — a direct integration method (newer)

As of June 2023 (version 2.0), supports T1 avatars (static head) and T2 avatars (blendshapes for facial animation). September 2023 update (v2.1) added skeletons for animation retargeting.

### 3.10 Unreal Engine - Webview SDK

**URL:** https://docs.avaturn.me/docs/integration/unreal/webview-sdk/

The Avaturn Unreal SDK enables integration of Avaturn avatars into Unreal Engine 5.0+. Capabilities include importing previously created avatars from the web platform and developing/editing avatars directly within UE-based applications.

Key Resources: Google Drive folder containing the SDK, demo project source code, and compiled builds for Windows and Android.

The framework builds upon the Ready Player Me Unreal framework. Copy necessary files from the downloaded demo project into your own projects.

Troubleshooting:

- Material loading failures in packaged builds: solved via cooking plugin directories
- Multiplayer functionality requiring proper httpURL configuration in developer settings

### 3.11 Android Integration

**URL:** https://docs.avaturn.me/docs/integration/mobile/android/

"Avaturn operates through native WebView, no extra libraries are required."

Example project: https://github.com/avaturn/avaturn-android-example

Modify `MainActivity.java` to replace the demo domain with your own project subdomain or API-provided link.

### 3.12 iOS Integration

**URL:** https://docs.avaturn.me/docs/integration/mobile/ios/

Integration for native Swift iOS applications. Operates through a native WebView without requiring additional libraries.

Example project: https://github.com/avaturn/ios-example

Update the URL initialization in `WebViewController.swift` from the demo domain to your own project URL.

### 3.13 API - Introduction

**URL:** https://docs.avaturn.me/docs/integration/api/introduction/

Key Capabilities:

- Integrate Avaturn while bypassing the sign-in interface (use your own authentication method)
- Customize user workflows
- Upload selfies directly rather than requiring users to scan through the UI
- Implement custom interfaces using the web SDK with event callbacks
- Generate avatar images for profile pictures
- Utilize native SDKs for Unreal and Unity

Getting Started:

1. Create a project at the developer portal
2. Generate an API authentication token
3. Maintain a paid subscription plan — **the API is not available on the free plan**

---

## 4. UX Customization

### 4.1 Overview

**URL:** https://docs.avaturn.me/docs/ux_customization/overview/

"Avaturn can be easily customized and extended with additional content."

Key Features:

- Upload personalized looks and accessories
- Adjust UI color schemes
- Modify the avatar's environment setting
- Incorporate branded logos

Getting Started: Create a project through the developer portal at developer.avaturn.me.

### 4.2 Custom Assets - Getting Started

**URL:** https://docs.avaturn.me/docs/ux_customization/assets/intro/

Creating custom assets is straightforward: "just grab one of our template avatars and create an asset to look good on it." Developers don't need separate versions for different body types — the platform automatically adjusts assets across all body variations.

Avatar Resources: Two downloadable template avatars — male body template and female body template, both in T-pose. Can switch to A-pose temporarily for simulation purposes before reverting to T-pose.

"You don't want pose-related wrinkles to be baked into the garment."

### 4.3 Custom Assets - Clothing

**URL:** https://docs.avaturn.me/docs/ux_customization/assets/clothing/

Key Requirements:

- Create an alpha mask for the avatar to hide parts covered by clothing (prevents visibility issues from deformations)
- Asset must share the same skeleton as the avatar with correct skinning weights (manual painting recommended)
- The mesh and avatar require proper alignment with identity global transforms
- Assets should be created at the same location as the avatar without moving it

Uploading: Access the developer portal's asset management panel, select the clothing tab, and upload both avatar and asset files in `.glb` format. Processing takes approximately 30 seconds. Verify the asset functions properly across all avatar body types before saving.

### 4.4 Custom Assets - Footwear

**URL:** https://docs.avaturn.me/docs/ux_customization/assets/footwear/

Pipeline is the same as for clothing. Key distinction: footwear textures are compressed to 512 pixels by default, whereas clothing textures use 1024 pixels.

### 4.5 Custom Assets - Eyewear

**URL:** https://docs.avaturn.me/docs/ux_customization/assets/eyewear/

Guidelines:

- "The lower polycount the better" for mesh optimization
- Glasses typically consist of two parts: frame and lens
- Lens uses translucent material; frame uses another material type

Recoloring: The system recognizes a mesh portion as recolorable if its material name **starts with** `lens`.

### 4.6 Custom Assets - Hair

**URL:** https://docs.avaturn.me/docs/ux_customization/assets/hair/

Haircap: An additional texture applied to the back of the head to minimize visual artifacts from transparent hair textures. Especially useful for hairstyles exposing head skin (bald, mohawk styles).

Recoloring: The recoloring mechanism "maps grayscale diffuse texture into the user-selected color." Darker gray values produce darker shades; lighter grays yield lighter colors. Can be toggled during asset upload.

Hats: Design hats independently of hair by following the clothing pipeline and defining an alpha map.

Mixing Hair with Hats: To prevent recoloring on accessories, include **no_ramp** in the accessory mesh's material name. Alternatively, disable recoloring entirely during upload.

### 4.7 Custom Assets - General Guidelines

**URL:** https://docs.avaturn.me/docs/ux_customization/assets/general_guidelines/

Technical Specifications:

- **Polygon Count:** No more than 7k triangles for the look (top + bottom) to ensure compatibility with older devices and slower connections.
- **Materials:** GLTF 2.0 format with PBR material pipelines. Supported maps: diffuse, normals, occlusion, roughness, metalness. Use a single opaque material (or alpha-clipped), with an optional separate alpha blend material.
- **Texture Resolution:** 1K resolution recommended; lower resolutions are preferable. Higher resolutions (2K/4K) may cause noticeable loading delays in browsers due to network bandwidth, CPU-to-GPU data transfer, and real-time shader compilation constraints.
