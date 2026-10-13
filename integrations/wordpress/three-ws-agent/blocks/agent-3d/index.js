/**
 * Editor script for the three-ws/agent-3d block. Plain ES5-safe JS against
 * the wp.* globals (no bundler) so the plugin ships zero build step.
 *
 * The editor preview renders through ServerSideRender, which calls the exact
 * same PHP render callback the front end uses, so what the editor shows is
 * what visitors get.
 */
( function ( blocks, element, blockEditor, components, serverSideRender, i18n ) {
	var el = element.createElement;
	var __ = i18n.__;
	var InspectorControls = blockEditor.InspectorControls;
	var PanelBody = components.PanelBody;
	var TextControl = components.TextControl;
	var SelectControl = components.SelectControl;
	var ServerSideRender = serverSideRender;

	blocks.registerBlockType( 'three-ws/agent-3d', {
		edit: function ( props ) {
			var attributes = props.attributes;
			var setAttributes = props.setAttributes;

			function set( key ) {
				return function ( value ) {
					var next = {};
					next[ key ] = value;
					setAttributes( next );
				};
			}

			return el(
				element.Fragment,
				{},
				el(
					InspectorControls,
					{},
					el(
						PanelBody,
						{ title: __( 'Agent source', 'three-ws-agent' ), initialOpen: true },
						el( TextControl, {
							label: __( 'On-chain URI (src)', 'three-ws-agent' ),
							help: __( 'e.g. agent://base/42. Takes priority over agent ID and model URL.', 'three-ws-agent' ),
							value: attributes.src,
							onChange: set( 'src' ),
						} ),
						el( TextControl, {
							label: __( 'Agent ID', 'three-ws-agent' ),
							help: __( 'Backend account ID or CAIP-10 agent ID. Used when no on-chain URI is set.', 'three-ws-agent' ),
							value: attributes.agentId,
							onChange: set( 'agentId' ),
						} ),
						el( TextControl, {
							label: __( 'Chain ID', 'three-ws-agent' ),
							help: __( 'Paired with a numeric Agent ID, e.g. 8453 for Base.', 'three-ws-agent' ),
							value: attributes.chainId,
							onChange: set( 'chainId' ),
						} ),
						el( TextControl, {
							label: __( 'Model URL', 'three-ws-agent' ),
							help: __( 'Bare GLB URL for an ad-hoc agent, used when no on-chain URI or agent ID is set.', 'three-ws-agent' ),
							value: attributes.modelUrl,
							onChange: set( 'modelUrl' ),
						} )
					),
					el(
						PanelBody,
						{ title: __( 'Appearance', 'three-ws-agent' ), initialOpen: false },
						el( SelectControl, {
							label: __( 'Background', 'three-ws-agent' ),
							value: attributes.background,
							options: [
								{ label: __( 'Transparent', 'three-ws-agent' ), value: 'transparent' },
								{ label: __( 'Dark', 'three-ws-agent' ), value: 'dark' },
								{ label: __( 'Light', 'three-ws-agent' ), value: 'light' },
							],
							onChange: set( 'background' ),
						} ),
						el( SelectControl, {
							label: __( 'Framing', 'three-ws-agent' ),
							value: attributes.framing,
							options: [
								{ label: __( 'Full', 'three-ws-agent' ), value: 'full' },
								{ label: __( 'Portrait', 'three-ws-agent' ), value: 'portrait' },
							],
							onChange: set( 'framing' ),
						} ),
						el( TextControl, {
							label: __( 'Poster image URL', 'three-ws-agent' ),
							value: attributes.poster,
							onChange: set( 'poster' ),
						} ),
						el( TextControl, {
							label: __( 'Width', 'three-ws-agent' ),
							value: attributes.width,
							onChange: set( 'width' ),
						} ),
						el( TextControl, {
							label: __( 'Height', 'three-ws-agent' ),
							value: attributes.height,
							onChange: set( 'height' ),
						} )
					)
				),
				el( 'div', { className: 'three-ws-agent-block-preview' },
					el( ServerSideRender, {
						block: 'three-ws/agent-3d',
						attributes: attributes,
					} )
				)
			);
		},
		save: function () {
			// Server-rendered: PHP (three_ws_agent_block_render) owns the markup.
			return null;
		},
	} );
} )(
	window.wp.blocks,
	window.wp.element,
	window.wp.blockEditor,
	window.wp.components,
	window.wp.serverSideRender,
	window.wp.i18n
);
