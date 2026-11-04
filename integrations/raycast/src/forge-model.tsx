import {
	Action,
	ActionPanel,
	Clipboard,
	Detail,
	Form,
	Keyboard,
	LaunchProps,
	Toast,
	getPreferenceValues,
	open,
	showToast,
	useNavigation,
} from '@raycast/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from 'node:crypto';
import { ForgeClient, ForgeError, ForgeResult, Tier } from './forge-api';

interface Preferences {
	tier?: Tier;
	baseUrl?: string;
}

function describeStatus(status: string, elapsedMs: number): string {
	const seconds = Math.round(elapsedMs / 1000);
	const label = status === 'queued' ? 'Waiting for a free GPU' : 'Generating mesh and textures';
	return `${label} (${seconds}s)`;
}

function recoveryFor(error: ForgeError | Error): string {
	const code = error instanceof ForgeError ? error.code : '';
	if (code === 'unreachable')
		return 'Check your connection, or the API Base URL in the extension preferences, then run the command again.';
	if (code === 'timeout')
		return 'The free lane is busy. Try again in a minute, or pick the Draft tier in preferences for the fastest queue.';
	if (code === 'invalid_prompt')
		return 'Describe one subject, for example: a small wooden chair.';
	if (error instanceof ForgeError && error.status === 429)
		return 'You have hit the free rate limit. Wait a few minutes and run the command again.';
	return 'Run the command again. If it keeps failing, try a simpler prompt.';
}

function Generating({ prompt, tier }: { prompt: string; tier: Tier }) {
	const { pop } = useNavigation();
	const preferences = getPreferenceValues<Preferences>();
	const client = useMemo(
		() =>
			new ForgeClient({
				baseUrl: preferences.baseUrl,
				clientHandle: `raycast-${randomUUID()}`,
			}),
		[preferences.baseUrl],
	);
	const [status, setStatus] = useState('Submitting to Forge');
	const [result, setResult] = useState<ForgeResult | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		client
			.generate(prompt, tier, (s, elapsed) => setStatus(describeStatus(s, elapsed)))
			.then((r) => {
				setResult(r);
				return showToast({ style: Toast.Style.Success, title: 'Model ready' });
			})
			.catch((e: Error) => {
				setError(e);
				return showToast({
					style: Toast.Style.Failure,
					title: 'Forge failed',
					message: e.message,
				});
			});
	}, [client, prompt, tier]);

	if (error) {
		return (
			<Detail
				navigationTitle="Forge failed"
				markdown={`# Forge could not finish\n\n${error.message}\n\n${recoveryFor(error)}`}
				actions={
					<ActionPanel>
						<Action title="Back to Prompt" onAction={pop} />
					</ActionPanel>
				}
			/>
		);
	}

	if (!result) {
		return (
			<Detail
				isLoading
				navigationTitle="Forging"
				markdown={`# ${prompt}\n\n${status}\n\nTier: ${tier}. Draft usually finishes in under a minute.`}
			/>
		);
	}

	return (
		<Detail
			navigationTitle="Model ready"
			markdown={`# ${prompt}\n\nYour GLB is ready.\n\n- Viewer: ${result.viewerUrl}\n- GLB: ${result.glbUrl}`}
			metadata={
				<Detail.Metadata>
					<Detail.Metadata.Label title="Tier" text={tier} />
					{result.backend ? (
						<Detail.Metadata.Label title="Engine" text={result.backend} />
					) : null}
					<Detail.Metadata.Link
						title="Open Viewer"
						target={result.viewerUrl}
						text="three.ws viewer"
					/>
					<Detail.Metadata.Link
						title="Download GLB"
						target={result.glbUrl}
						text="model.glb"
					/>
				</Detail.Metadata>
			}
			actions={
				<ActionPanel>
					<Action
						title="Open in Browser Viewer"
						onAction={() => open(result.viewerUrl)}
					/>
					<Action
						title="Copy GLB URL"
						shortcut={Keyboard.Shortcut.Common.Copy}
						onAction={async () => {
							await Clipboard.copy(result.glbUrl);
							await showToast({
								style: Toast.Style.Success,
								title: 'GLB URL copied',
							});
						}}
					/>
					<Action
						title="Copy Viewer Link"
						shortcut={Keyboard.Shortcut.Common.Copy}
						onAction={async () => {
							await Clipboard.copy(result.viewerUrl);
							await showToast({
								style: Toast.Style.Success,
								title: 'Viewer link copied',
							});
						}}
					/>
					<Action.OpenInBrowser title="Download GLB" url={result.glbUrl} />
				</ActionPanel>
			}
		/>
	);
}

export default function Command(props: LaunchProps<{ arguments: { prompt?: string } }>) {
	const preferences = getPreferenceValues<Preferences>();
	const { push } = useNavigation();
	const [prompt, setPrompt] = useState(props.arguments.prompt ?? '');
	const [promptError, setPromptError] = useState<string | undefined>();
	const tier: Tier = preferences.tier ?? 'draft';

	function submit() {
		if (prompt.trim().length < 3) {
			setPromptError('Describe one subject in at least 3 characters.');
			return;
		}
		push(<Generating prompt={prompt.trim()} tier={tier} />);
	}

	return (
		<Form
			navigationTitle="Forge a 3D Model"
			actions={
				<ActionPanel>
					<Action.SubmitForm title="Forge Model" onSubmit={submit} />
				</ActionPanel>
			}
		>
			<Form.TextArea
				id="prompt"
				title="Prompt"
				placeholder="a small wooden chair"
				info="Describe one object. Forge returns a textured GLB from the free engine grid."
				value={prompt}
				error={promptError}
				onChange={(value) => {
					setPrompt(value);
					if (promptError) setPromptError(undefined);
				}}
				autoFocus
			/>
			<Form.Description
				title="Tier"
				text={`${tier} (change it in the extension preferences)`}
			/>
		</Form>
	);
}
