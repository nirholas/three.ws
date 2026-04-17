import React, { useRef, useEffect, useState } from 'react';
import { AgentBridge } from './bridge';
import { PluginSettings, DEFAULT_API_ORIGIN } from './config-schema';

export interface AgentPaneProps {
	settings: PluginSettings;
}

/**
 * Main plugin component that renders a 3D agent avatar.
 * Listens to chat assistant messages via Lobe hooks and forwards them to the
 * agent via the bridge protocol.
 */
export const AgentPane: React.FC<AgentPaneProps> = ({ settings }) => {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const bridgeRef = useRef<AgentBridge | null>(null);
	const [isReady, setIsReady] = useState(false);
	const [frameHeight, setFrameHeight] = useState(420);

	const apiOrigin = settings.apiOrigin || DEFAULT_API_ORIGIN;
	const embedUrl = `${apiOrigin}/agent/${settings.agentId}/embed?bg=transparent&name=1`;

	// Initialize bridge on mount.
	useEffect(() => {
		const bridge = new AgentBridge({
			agentId: settings.agentId,
			iframeRef,
			onReady: () => setIsReady(true),
			onResize: (height: number) => setFrameHeight(Math.min(height, 600)),
		});

		bridge.mount();
		bridgeRef.current = bridge;

		return () => {
			bridge.unmount();
		};
	}, [settings.agentId]);

	// TODO: Hook into Lobe's onAssistantMessage event.
	// This depends on what @lobehub/ui@latest exports.
	// If usePluginStore or onAssistantMessage doesn't exist,
	// this should be provided by the host Lobe fork.
	useEffect(() => {
		const handleLobeMessage = (ev: CustomEvent) => {
			const { content } = ev.detail || {};
			if (content && bridgeRef.current) {
				bridgeRef.current.speak(content);
			}
		};

		// Placeholder: listen for a custom event from the Lobe host.
		// Replace with actual Lobe hook when SDK is available.
		window.addEventListener('lobe:assistantMessage', handleLobeMessage as EventListener);

		return () => {
			window.removeEventListener('lobe:assistantMessage', handleLobeMessage as EventListener);
		};
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
			}}
		>
			{!isReady && (
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: '100%',
						height: '100%',
						backgroundColor: 'rgba(0, 0, 0, 0.1)',
						color: 'rgba(0, 0, 0, 0.5)',
						fontSize: '12px',
					}}
				>
					Loading agent…
				</div>
			)}
			<iframe
				ref={iframeRef}
				src={embedUrl}
				title={`3D Agent ${settings.agentId}`}
				style={{
					width: '100%',
					height: '100%',
					border: 'none',
					display: isReady ? 'block' : 'none',
				}}
				sandbox="allow-same-origin allow-scripts allow-presentation"
			/>
		</div>
	);
};

export default AgentPane;
