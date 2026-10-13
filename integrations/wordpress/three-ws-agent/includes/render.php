<?php
/**
 * Shared render path for the block and the [three_ws_agent] shortcode: both
 * build the same attribute set and hand it to three_ws_agent_render().
 *
 * @package ThreeWsAgent
 */

if (!defined('ABSPATH')) {
	exit;
}

const THREE_WS_AGENT_SCRIPT_HANDLE = 'three-ws-agent-3d';

/**
 * Registers the pinned <agent-3d> loader script once per request. Safe to
 * call from both the block render callback and the shortcode handler.
 */
function three_ws_agent_register_script() {
	if (wp_script_is(THREE_WS_AGENT_SCRIPT_HANDLE, 'registered')) {
		return;
	}

	wp_register_script(
		THREE_WS_AGENT_SCRIPT_HANDLE,
		THREE_WS_AGENT3D_JS_URL,
		array(),
		THREE_WS_AGENT3D_VERSION,
		array('strategy' => 'defer')
	);
	wp_script_add_data(THREE_WS_AGENT_SCRIPT_HANDLE, 'type', 'module');
	wp_script_add_data(THREE_WS_AGENT_SCRIPT_HANDLE, 'integrity', THREE_WS_AGENT3D_JS_INTEGRITY);
	wp_script_add_data(THREE_WS_AGENT_SCRIPT_HANDLE, 'crossorigin', 'anonymous');
}

/**
 * Rewrites the registered loader's <script> tag to carry type="module",
 * integrity and crossorigin, which wp_enqueue_script's own API does not
 * expose for ESM loads. Added once, from three_ws_agent_render().
 *
 * @param string $tag    The <script> tag WordPress built for $handle.
 * @param string $handle The script handle being printed.
 * @param string $src     The script's resolved src attribute.
 * @return string
 */
function three_ws_agent_filter_script_tag($tag, $handle, $src) {
	if (THREE_WS_AGENT_SCRIPT_HANDLE !== $handle) {
		return $tag;
	}

	$integrity = esc_attr(wp_scripts()->get_data(THREE_WS_AGENT_SCRIPT_HANDLE, 'integrity'));
	$crossorigin = esc_attr(wp_scripts()->get_data(THREE_WS_AGENT_SCRIPT_HANDLE, 'crossorigin'));

	// $src was already registered and enqueued with wp_register_script() /
	// wp_enqueue_script() above; this filter only rewrites that one script's
	// own output tag to add type="module", integrity and crossorigin, which
	// core's enqueue API has no argument for.
	$markup = '<script type="module" src="' . esc_url($src) . '" integrity="' . $integrity . '" crossorigin="' . $crossorigin . '"></script>' . "\n"; // phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript

	return $markup;
}
add_filter('script_loader_tag', 'three_ws_agent_filter_script_tag', 10, 3);

/**
 * Renders a <agent-3d> element from a normalized attribute set. Exactly one
 * of $atts['src'], $atts['agent_id'] or $atts['model'] should be set; if more
 * than one is, the element's own priority order (src > agent-id > manifest >
 * body) decides which wins, same as every other <agent-3d> embed.
 *
 * @param array $atts {
 *     @type string $src         On-chain agent:// URI.
 *     @type string $agent_id    Backend account id or CAIP-10 agent id.
 *     @type string $chain_id     Chain id, paired with a numeric agent_id.
 *     @type string $model       Bare GLB URL for an ad-hoc agent.
 *     @type string $background  transparent|dark|light.
 *     @type string $framing     full|portrait.
 *     @type string $poster      Poster image URL shown while the model loads.
 *     @type string $width       CSS width, e.g. "100%" or "480px".
 *     @type string $height      CSS height, e.g. "520px".
 * }
 * @return string
 */
function three_ws_agent_render($atts) {
	three_ws_agent_register_script();
	wp_enqueue_script(THREE_WS_AGENT_SCRIPT_HANDLE);

	$src = isset($atts['src']) ? trim((string) $atts['src']) : '';
	$agent_id = isset($atts['agent_id']) ? trim((string) $atts['agent_id']) : '';
	$chain_id = isset($atts['chain_id']) ? trim((string) $atts['chain_id']) : '';
	$model = isset($atts['model']) ? trim((string) $atts['model']) : '';
	$background = isset($atts['background']) ? trim((string) $atts['background']) : 'transparent';
	$framing = isset($atts['framing']) ? trim((string) $atts['framing']) : 'full';
	$poster = isset($atts['poster']) ? trim((string) $atts['poster']) : '';
	$width = isset($atts['width']) ? trim((string) $atts['width']) : '100%';
	$height = isset($atts['height']) ? trim((string) $atts['height']) : '480px';

	if ('' === $src && '' === $agent_id && '' === $model) {
		return sprintf(
			'<p class="three-ws-agent-placeholder">%s</p>',
			esc_html__('three.ws Agent: set an agent ID, on-chain URI or model URL to render an avatar here.', 'three-ws-agent')
		);
	}

	if (!in_array($background, array('transparent', 'dark', 'light'), true)) {
		$background = 'transparent';
	}
	if (!in_array($framing, array('full', 'portrait'), true)) {
		$framing = 'full';
	}

	$attrs = array();
	if ('' !== $src) {
		$attrs[] = sprintf('src="%s"', esc_attr($src));
	} elseif ('' !== $agent_id) {
		$attrs[] = sprintf('agent-id="%s"', esc_attr($agent_id));
		if ('' !== $chain_id) {
			$attrs[] = sprintf('chain-id="%s"', esc_attr($chain_id));
		}
	} elseif ('' !== $model) {
		$attrs[] = sprintf('body="%s"', esc_url($model));
	}

	$attrs[] = sprintf('background="%s"', esc_attr($background));
	$attrs[] = sprintf('framing="%s"', esc_attr($framing));
	if ('' !== $poster) {
		$attrs[] = sprintf('poster="%s"', esc_url($poster));
	}

	return sprintf(
		'<agent-3d %1$s style="display:block;width:%2$s;height:%3$s"></agent-3d>',
		implode(' ', $attrs),
		esc_attr($width),
		esc_attr($height)
	);
}
