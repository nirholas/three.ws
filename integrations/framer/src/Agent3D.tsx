// Framer code component: paste this file (and Agent3DView.tsx and
// pinned-release.ts alongside it) into a Framer project's code file panel, or
// publish it as a Framer package. Only runs inside Framer's canvas/published
// site, where the "framer" module resolves; the real rendering logic lives in
// Agent3DView.tsx so it can be tested outside Framer. See README.md.
import { addPropertyControls, ControlType } from 'framer';
import { Agent3DView } from './Agent3DView';

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 */
export default function Agent3D(props: {
	agent: string;
	agentId: string;
	chainId: string;
	model: string;
	background: 'transparent' | 'dark' | 'light';
	framing: 'full' | 'portrait';
	// Framer's Image control resolves to an asset object ({ src, alt, ... }),
	// not a bare URL.
	poster?: { src: string };
	autoplay: boolean;
	width?: number;
	height?: number;
}) {
	return <Agent3DView {...props} poster={props.poster?.src} width="100%" height="100%" />;
}

addPropertyControls(Agent3D, {
	agent: {
		type: ControlType.String,
		title: 'On-chain URI',
		placeholder: 'agent://base/42',
		description: 'Takes priority over Agent ID and Model URL.',
	},
	agentId: {
		type: ControlType.String,
		title: 'Agent ID',
		placeholder: 'a_abc123',
		description: 'Backend account ID or CAIP-10 ID. Used when On-chain URI is empty.',
	},
	chainId: {
		type: ControlType.String,
		title: 'Chain ID',
		placeholder: '8453',
		description: 'Paired with a numeric Agent ID.',
		hidden: (props) => !props.agentId,
	},
	model: {
		type: ControlType.String,
		title: 'Model URL',
		placeholder: 'https://three.ws/avatars/default.glb',
		description: 'Bare GLB for an ad-hoc agent. Used when On-chain URI and Agent ID are both empty.',
		hidden: (props) => Boolean(props.agent || props.agentId),
	},
	background: {
		type: ControlType.Enum,
		title: 'Background',
		options: ['transparent', 'dark', 'light'],
		optionTitles: ['Transparent', 'Dark', 'Light'],
		defaultValue: 'transparent',
	},
	framing: {
		type: ControlType.Enum,
		title: 'Framing',
		options: ['full', 'portrait'],
		optionTitles: ['Full', 'Portrait'],
		defaultValue: 'full',
	},
	poster: {
		type: ControlType.Image,
		title: 'Poster',
		description: 'Shown while the model loads.',
	},
	autoplay: {
		type: ControlType.Boolean,
		title: 'Autoplay',
		description: 'Boot immediately instead of waiting for the component to scroll into view.',
		defaultValue: false,
	},
});
