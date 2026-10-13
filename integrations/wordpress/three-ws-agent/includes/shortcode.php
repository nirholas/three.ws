<?php
/**
 * [three_ws_agent] shortcode: the same embed for the classic editor, widgets,
 * and any theme template that cannot use the block.
 *
 * @package ThreeWsAgent
 */

if (!defined('ABSPATH')) {
	exit;
}

/**
 * [three_ws_agent src="agent://base/42" background="dark" framing="portrait"]
 * [three_ws_agent model="https://three.ws/avatars/default.glb" height="600px"]
 *
 * @param array $atts Shortcode attributes; see three_ws_agent_render() for the keys.
 * @return string
 */
function three_ws_agent_shortcode($atts) {
	$atts = shortcode_atts(
		array(
			'src' => '',
			'agent_id' => '',
			'chain_id' => '',
			'model' => '',
			'background' => 'transparent',
			'framing' => 'full',
			'poster' => '',
			'width' => '100%',
			'height' => '480px',
		),
		$atts,
		'three_ws_agent'
	);

	return three_ws_agent_render($atts);
}
add_shortcode('three_ws_agent', 'three_ws_agent_shortcode');
