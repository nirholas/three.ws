export interface AgentPanelOptions {
	title?: string;
	welcome?: string;
	placeholder?: string;
	onMessage?: (text: string) => string | Promise<string>;
	voice?: boolean;
}

export declare class AgentPanel {
	constructor(opts?: AgentPanelOptions);
	mount(container: HTMLElement): this;
	open(): void;
	close(): void;
	addMessage(role: string, text: string): void;
	dispose(): void;
}
