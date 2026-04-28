import React, { useRef, useEffect, useState } from 'react';
import { AgentBridge } from './bridge';
import { PluginSettings, DEFAULT_API_ORIGIN } from './config-schema';

export interface AgentPaneProps {
	settings: PluginSettings;
}

/**
 * Sidebar plugin component that renders a three.ws avatar and
 * forwards LobeChat tool-call payloads to the agent via the bridge.
 *
 * LobeChat delivers tool calls by postMessage into the plugin iframe:
 *   { type: 'LobePlugin.renderPlugin', payload: { apiName, arguments } }
 *
 * When @lobehub/chat-plugin-sdk ships a stable usePluginStore hook,
 * replace the window message listener below with that hook so the
 * React render cycle drives the effect instead of a raw event.
 */
export const AgentPane: React.FC<AgentPaneProps> = ({ settings }) => {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const bridgeRef = useRef<AgentBridge | null>(null);
	const [isReady, setIsReady] = useState(false);
	const [frameHeight, setFrameHeight] = useState(480);

	const apiOrigin = settings.apiOrigin || DEFAULT_API_ORIGIN;
	// Pass agent id via query param; boot.js reads ?agent=
	const embedUrl = `${apiOrigin}/lobehub/iframe/?agent=${encodeURIComponent(settings.agentId)}&bg=transparent`;

	// Mount bridge once per agentId.
	useEffect(() => {
		setIsReady(false);
		const bridge = new AgentBridge({
			agentId: settings.agentId,
			iframeRef,
			onReady: () => setIsReady(true),
			onResize: (h: number) => setFrameHeight(Math.min(Math.max(h, 200), 640)),
		});
		bridge.mount();
		bridgeRef.current = bridge;
		return () => {
			bridge.unmount();
			bridgeRef.current = null;
		};
	}, [settings.agentId]);

	// Observe LobeChat tool calls delivered as postMessage to this plugin iframe.
	//
	// LobeChat sends: { type: 'LobePlugin.renderPlugin', payload: { apiName, arguments } }
	// where `arguments` is a JSON string of the tool's input object.
	//
	// Fallback path: if LobeChat changes its message contract or a host-level fork
	// dispatches { type: 'lobe:assistantMessage', detail: { content } } as a custom
	// event, the second listener below handles that case.
	useEffect(() => {
		const handleMessage = (ev: MessageEvent) => {
			if (!ev.data || typeof ev.data !== 'object') return;
			const { type, payload } = ev.data as {
				type?: string;
				payload?: Record<string, unknown>;
			};
			if (type !== 'LobePlugin.renderPlugin' || !payload) return;

			const apiName = payload['apiName'] as string | undefined;
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse((payload['arguments'] as string) || '{}');
			} catch {
				return;
			}

			const bridge = bridgeRef.current;
			if (!bridge) return;

			switch (apiName) {
				case 'speak':
					if (typeof args['text'] === 'string') {
						bridge
							.speak(args['text'], {
								sentiment:
									typeof args['sentiment'] === 'number' ? args['sentiment'] : 0,
							})
							.catch(() => undefined);
					}
					break;
				case 'gesture':
					if (typeof args['name'] === 'string') {
						bridge.gesture(args['name']).catch(() => undefined);
					}
					break;
				case 'emote':
					if (typeof args['trigger'] === 'string') {
						bridge
							.emote({
								trigger: args['trigger'],
								weight: typeof args['weight'] === 'number' ? args['weight'] : 1,
							})
							.catch(() => undefined);
					}
					break;
				case 'render_agent':
					if (typeof args['agentId'] === 'string') {
						bridge.setAgent(args['agentId']).catch(() => undefined);
					}
					break;
			}
		};

		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, []);

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				width: '100%',
				height: frameHeight,
				backgroundColor: 'transparent',
				borderRadius: '8px',
				overflow: 'hidden',
				position: 'relative',
			}}
		>
			{!isReady && (
				<div
					style={{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						color: 'rgba(128, 128, 128, 0.6)',
						fontSize: '12px',
						fontFamily: 'system-ui, sans-serif',
					}}
				>
					Loading agent…
				</div>
			)}
			<iframe
				ref={iframeRef}
				src={embedUrl}
				title={`three.ws ${settings.agentId}`}
				style={{
					width: '100%',
					height: '100%',
					border: 'none',
					opacity: isReady ? 1 : 0,
					transition: 'opacity 0.3s ease',
				}}
				sandbox="allow-same-origin allow-scripts allow-presentation"
			/>
		</div>
	);
};

export default AgentPane;
