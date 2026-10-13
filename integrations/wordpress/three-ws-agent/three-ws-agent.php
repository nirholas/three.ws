<?php
/**
 * Plugin Name:       three.ws Agent
 * Plugin URI:        https://three.ws/embed
 * Description:       Embed a live, animated three.ws 3D AI agent anywhere in the block editor, SRI-pinned to an immutable release. No build step, no API key.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            three.ws
 * Author URI:        https://three.ws
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       three-ws-agent
 *
 * @package ThreeWsAgent
 */

if (!defined('ABSPATH')) {
	exit;
}

define('THREE_WS_AGENT_PLUGIN_FILE', __FILE__);
define('THREE_WS_AGENT_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('THREE_WS_AGENT_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once THREE_WS_AGENT_PLUGIN_DIR . 'includes/pinned-release.php';
require_once THREE_WS_AGENT_PLUGIN_DIR . 'includes/render.php';
require_once THREE_WS_AGENT_PLUGIN_DIR . 'includes/block.php';
require_once THREE_WS_AGENT_PLUGIN_DIR . 'includes/shortcode.php';
