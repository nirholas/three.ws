// three.ws Claude Artifact Bundle
// Lightweight viewer for agents inside Claude Artifacts
// Loads three.js from CDN (esm.sh is allowed in artifact sandboxes)
// Usage: <script src="artifact.js"></script>
//        <div id="agent3d" data-agent-id="123"></div>

(async function initArtifact() {
	const container = document.getElementById('agent3d');
	if (!container) return;

	// Setup container
	container.style.cssText =
		'position: relative; width: 100%; height: 100%; min-height: 400px; background: #000;';

	// Add caption
	const caption = document.createElement('div');
	caption.className = 'agent3d-caption';
	caption.style.cssText = `
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		padding: 12px 16px;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 14px;
		z-index: 5;
		text-align: center;
	`;
	caption.textContent = 'Loading...';
	container.appendChild(caption);

	// Get agent ID from config or data attributes
	const scriptTag = document.querySelector(
		'script[type="application/json"][id="agent3d-config"]',
	);
	const config = scriptTag ? JSON.parse(scriptTag.textContent) : {};
	const agentId = config.agentId || container.dataset.agentId;
	const origin = config.origin || container.dataset.origin || 'https://three.ws/';

	if (!agentId) {
		caption.textContent = 'Missing agent ID';
		return;
	}

	try {
		// Load three.js modules from CDN
		const THREE = await import('https://esm.sh/three@0.176.0');
		const { GLTFLoader } = await import(
			'https://esm.sh/three@0.176.0/examples/jsm/loaders/GLTFLoader.js'
		);
		const { OrbitControls } = await import(
			'https://esm.sh/three@0.176.0/examples/jsm/controls/OrbitControls.js'
		);

		// Fetch agent data
		const agentRes = await fetch(`${origin}/api/agents/${agentId}`, {
			mode: 'cors',
			credentials: 'omit',
		});

		if (!agentRes.ok) {
			caption.textContent = 'Agent not found';
			return;
		}

		const agentData = await agentRes.json();
		const agent = agentData.agent;

		// Update caption with agent name
		caption.textContent = agent.name || 'Agent';

		// Setup scene
		const width = container.clientWidth;
		const height = container.clientHeight;

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x000000);
		scene.fog = new THREE.Fog(0x000000, 1, 1000);

		// Lighting
		const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
		scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(5, 10, 7);
		directionalLight.castShadow = true;
		directionalLight.shadow.mapSize.width = 2048;
		directionalLight.shadow.mapSize.height = 2048;
		directionalLight.shadow.camera.near = 0.5;
		directionalLight.shadow.camera.far = 500;
		scene.add(directionalLight);

		// Camera
		const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
		camera.position.set(0, 1.5, 3);

		// Renderer
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
		renderer.setSize(width, height);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFShadowMap;
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;

		const canvas = container.querySelector('canvas');
		if (canvas) canvas.remove();
		container.insertBefore(renderer.domElement, caption);

		// Controls
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.05;
		controls.enableZoom = true;
		controls.autoRotate = true;
		controls.autoRotateSpeed = 2;
		controls.enablePan = false;
		controls.minDistance = 2;
		controls.maxDistance = 10;

		// Animation loop
		function animate() {
			requestAnimationFrame(animate);
			controls.update();
			renderer.render(scene, camera);
		}
		animate();

		// Handle resize
		window.addEventListener('resize', () => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		});
	} catch (err) {
		console.error('[artifact] error:', err);
		caption.textContent = 'Failed to load viewer';
	}
})();
