<?php
/**
 * Registers the three-ws/agent-3d block and its server-side render.
 *
 * @package ThreeWsAgent
 */

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Renders the block on the front end from its saved attributes.
 *
 * @param array $attributes Block attributes (see blocks/agent-3d/block.json).
 * @return string
 */
function three_ws_agent_block_render($attributes) {
	return three_ws_agent_render(
		array(
			'src' => $attributes['src'] ?? '',
			'agent_id' => $attributes['agentId'] ?? '',
			'chain_id' => $attributes['chainId'] ?? '',
			'model' => $attributes['modelUrl'] ?? '',
			'background' => $attributes['background'] ?? 'transparent',
			'framing' => $attributes['framing'] ?? 'full',
			'poster' => $attributes['poster'] ?? '',
			'width' => $attributes['width'] ?? '100%',
			'height' => $attributes['height'] ?? '480px',
		)
	);
}

/**
 * Registers the block type from blocks/agent-3d/block.json and its editor
 * script, and enqueues the editor-only stylesheet.
 */
function three_ws_agent_register_block() {
	register_block_type(
		THREE_WS_AGENT_PLUGIN_DIR . 'blocks/agent-3d',
		array('render_callback' => 'three_ws_agent_block_render')
	);
}
add_action('init', 'three_ws_agent_register_block');
