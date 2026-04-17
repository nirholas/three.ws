/**
 * PostMessage bridge wrapping the agent embed iframe.
 * Implements the v1 protocol from /public/agent/embed.html (FROZEN).
 */

interface AgentHelloMessage {
	type: 'agent:hello';
	agentId: string;
	host?: string;
}

interface AgentActionMessage {
	type: 'agent:action';
	agentId: string;
	action: Record<string, unknown>;
}

interface AgentPingMessage {
	type: 'agent:ping';
	agentId: string;
	id: string;
}

interface AgentReadyMessage {
	type: 'agent:ready';
	agentId: string;
	version: string;
	capabilities: string[];
	name?: string;
}

type OutboundMessage = AgentHelloMessage | AgentActionMessage | AgentPingMessage;

export interface BridgeOptions {
	agentId: string;
	iframeRef: React.RefObject<HTMLIFrameElement>;
	onReady?: (msg: AgentReadyMessage) => void;
	onResize?: (height: number) => void;
	onAction?: (action: Record<string, unknown>) => void;
}

export class AgentBridge {
	private agentId: string;
	private iframeRef: React.RefObject<HTMLIFrameElement>;
	private onReady?: (msg: AgentReadyMessage) => void;
	private onResize?: (height: number) => void;
	private onAction?: (action: Record<string, unknown>) => void;
	private messageHandler: (ev: MessageEvent) => void;

	constructor(opts: BridgeOptions) {
		this.agentId = opts.agentId;
		this.iframeRef = opts.iframeRef;
		this.onReady = opts.onReady;
		this.onResize = opts.onResize;
		this.onAction = opts.onAction;

		this.messageHandler = (ev: MessageEvent) => this.handleMessage(ev);
	}

	mount(): void {
		window.addEventListener('message', this.messageHandler);
		this.sayHello();
	}

	unmount(): void {
		window.removeEventListener('message', this.messageHandler);
	}

	private handleMessage(ev: MessageEvent): void {
		const msg = ev.data;
		if (!msg || typeof msg !== 'object') return;
		if (msg.agentId !== this.agentId) return;

		switch (msg.type) {
			case 'agent:ready':
				this.onReady?.(msg);
				break;
			case 'agent:resize':
				this.onResize?.(msg.height);
				break;
			case 'agent:action':
				this.onAction?.(msg.action);
				break;
		}
	}

	private sayHello(): void {
		this.post({
			type: 'agent:hello',
			agentId: this.agentId,
		});
	}

	speak(text: string): void {
		this.post({
			type: 'agent:action',
			agentId: this.agentId,
			action: {
				type: 'speak',
				payload: { text },
			},
		});
	}

	private post(msg: OutboundMessage): void {
		const frame = this.iframeRef.current;
		if (frame?.contentWindow) {
			frame.contentWindow.postMessage(msg, '*');
		}
	}
}
