// The actual rendering logic behind the Framer code component. Deliberately
// framer-free (no "framer" import) so it can be unit/E2E tested with plain
// React outside Framer's canvas, which is the only place the "framer" module
// resolves. Agent3D.tsx is the thin Framer-specific wrapper around this.
import { useEffect, useRef } from 'react';
import { AGENT3D_JS_INTEGRITY, AGENT3D_JS_URL } from './pinned-release';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace JSX {
		interface IntrinsicElements {
			'agent-3d': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
		}
	}
}

export type Agent3DViewProps = {
	/** On-chain URI, e.g. "agent://base/42". Takes priority over agentId and model. */
	agent?: string;
	/** Backend account id or CAIP-10 agent id. Used when agent is empty. */
	agentId?: string;
	/** Chain id, paired with a numeric agentId. */
	chainId?: string;
	/** Bare GLB URL for an ad-hoc agent, used when agent and agentId are both empty. */
	model?: string;
	background?: 'transparent' | 'dark' | 'light';
	framing?: 'full' | 'portrait';
	poster?: string;
	/** Skip the IntersectionObserver wait and boot on connect (the "eager" attribute). */
	autoplay?: boolean;
	width?: string | number;
	height?: string | number;
};

let loaderPromise: Promise<void> | null = null;

/**
 * Injects the pinned <agent-3d> loader script once per page, SRI-verified
 * against the exact release this component ships against. Safe to call from
 * multiple mounted instances; the browser refuses the script outright if its
 * bytes ever stop matching AGENT3D_JS_INTEGRITY.
 */
function ensureLoader(): Promise<void> {
	if (loaderPromise) return loaderPromise;
	if (customElements.get('agent-3d')) {
		loaderPromise = Promise.resolve();
		return loaderPromise;
	}
	loaderPromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.type = 'module';
		script.src = AGENT3D_JS_URL;
		script.integrity = AGENT3D_JS_INTEGRITY;
		script.crossOrigin = 'anonymous';
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`three.ws: failed to load the pinned agent-3d loader from ${AGENT3D_JS_URL}`));
		document.head.appendChild(script);
	});
	return loaderPromise;
}

export function Agent3DView(props: Agent3DViewProps) {
	const {
		agent = '',
		agentId = '',
		chainId = '',
		model = '',
		background = 'transparent',
		framing = 'full',
		poster = '',
		autoplay = false,
		width = '100%',
		height = '100%',
	} = props;

	const ref = useRef<HTMLElement>(null);

	useEffect(() => {
		ensureLoader().catch((err) => console.error(err));
	}, []);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		el.removeAttribute('src');
		el.removeAttribute('agent-id');
		el.removeAttribute('chain-id');
		el.removeAttribute('body');

		if (agent) {
			el.setAttribute('src', agent);
		} else if (agentId) {
			el.setAttribute('agent-id', agentId);
			if (chainId) el.setAttribute('chain-id', chainId);
		} else if (model) {
			el.setAttribute('body', model);
		}

		el.setAttribute('background', background);
		el.setAttribute('framing', framing);
		if (poster) el.setAttribute('poster', poster);
		else el.removeAttribute('poster');
		if (autoplay) el.setAttribute('eager', '');
		else el.removeAttribute('eager');
	}, [agent, agentId, chainId, model, background, framing, poster, autoplay]);

	if (!agent && !agentId && !model) {
		return (
			<div
				style={{
					width,
					height,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					border: '1px dashed #999',
					color: '#777',
					fontSize: 13,
					textAlign: 'center',
					padding: 8,
				}}
			>
				Set an agent, agent ID, or model URL
			</div>
		);
	}

	return <agent-3d ref={ref as React.RefObject<HTMLElement>} style={{ display: 'block', width, height }} />;
}
