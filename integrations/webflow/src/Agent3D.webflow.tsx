// Webflow Code Component: `webflow devlink bundle` auto-discovers any
// *.webflow.tsx file (the CLI's default "components" glob) and bundles its
// default export, which must come from declareComponent(). Only resolves
// inside Webflow's devlink bundler/runtime; the real rendering logic lives in
// Agent3DView.tsx so it can be tested outside Webflow. See README.md.
import { declareComponent } from '@webflow/react';
import { props } from '@webflow/data-types';
import { Agent3DView } from './Agent3DView';

type Agent3DProps = {
	agent: string;
	agentId: string;
	chainId: string;
	model: string;
	background: string;
	framing: string;
	// props.Image resolves to an asset object ({ src, alt? }), not a bare URL.
	poster?: { src: string; alt?: string };
	autoplay: boolean;
};

function Agent3D(data: Agent3DProps) {
	return (
		<Agent3DView
			agent={data.agent}
			agentId={data.agentId}
			chainId={data.chainId}
			model={data.model}
			background={data.background as 'transparent' | 'dark' | 'light'}
			framing={data.framing as 'full' | 'portrait'}
			poster={data.poster?.src}
			autoplay={data.autoplay}
			width="100%"
			height="100%"
		/>
	);
}

export default declareComponent(Agent3D, {
	name: 'three.ws Agent',
	description: 'A live, animated 3D AI agent: a Three.js viewer, voice I/O, an LLM brain and memory in one embed.',
	group: 'three.ws',
	props: {
		agent: props.Text({
			name: 'On-chain URI',
			defaultValue: '',
			tooltip: 'agent://base/42. Takes priority over Agent ID and Model URL.',
		}),
		agentId: props.Text({
			name: 'Agent ID',
			defaultValue: '',
			tooltip: 'Backend account ID or CAIP-10 ID. Used when On-chain URI is empty.',
		}),
		chainId: props.Text({
			name: 'Chain ID',
			defaultValue: '',
			tooltip: 'Paired with a numeric Agent ID.',
		}),
		model: props.Text({
			name: 'Model URL',
			defaultValue: '',
			tooltip: 'Bare GLB for an ad-hoc agent. Used when On-chain URI and Agent ID are both empty.',
		}),
		background: props.Variant({
			name: 'Background',
			options: ['transparent', 'dark', 'light'],
			defaultValue: 'transparent',
		}),
		framing: props.Variant({
			name: 'Framing',
			options: ['full', 'portrait'],
			defaultValue: 'full',
		}),
		poster: props.Image({
			name: 'Poster',
			tooltip: 'Shown while the model loads.',
		}),
		autoplay: props.Boolean({
			name: 'Autoplay',
			defaultValue: false,
			tooltip: 'Boot immediately instead of waiting for the component to scroll into view.',
		}),
	},
});
