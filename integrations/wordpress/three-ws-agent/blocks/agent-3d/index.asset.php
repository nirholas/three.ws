<?php
/**
 * Hand-written in place of a @wordpress/scripts build: this plugin ships no
 * bundler, so index.js is plain ES5-safe JS using the wp.* globals below
 * directly. WordPress reads this file's "dependencies" to enqueue them
 * before index.js, the same contract wp-scripts' build output uses.
 *
 * @package ThreeWsAgent
 */

return array(
	'dependencies' => array(
		'wp-blocks',
		'wp-element',
		'wp-block-editor',
		'wp-components',
		'wp-server-side-render',
		'wp-i18n',
	),
	'version' => THREE_WS_AGENT3D_VERSION,
);
