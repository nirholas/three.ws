/**
 * GLTFLoader plugin for KHR_node_visibility. three.js does not read the
 * extension, so a node the editor hid (and exported as `visible: false`) would
 * come back visible. `extras.threeWsHidden` is honoured too, for files written
 * by tools that kept only the intent.
 */
export function installNodeVisibility(loader) {
	loader.register((parser) => ({
		name: 'KHR_node_visibility',
		async afterRoot() {
			const nodes = parser.json.nodes || [];
			await Promise.all(
				nodes.map(async (def, index) => {
					const hidden =
						def.extensions?.KHR_node_visibility?.visible === false ||
						def.extras?.threeWsHidden === true;
					if (!hidden) return;
					const node = await parser.getDependency('node', index);
					node.visible = false;
				}),
			);
		},
	}));
}
