import {
	Action,
	ActionPanel,
	Clipboard,
	Detail,
	Form,
	Icon,
	Keyboard,
	LaunchProps,
	Toast,
	getPreferenceValues,
	open,
	openExtensionPreferences,
	showToast,
	useNavigation,
} from '@raycast/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { API_KEYS_URL, ForgeError, ForgeResult, Tier } from './forge-api';
import { Preferences, clientFromPreferences } from './client';

function needsKey(error: Error): boolean {
	return (
		error instanceof ForgeError && (error.code === 'sign_in_required' || error.status === 401)
	);
}

function describeStatus(status: string, elapsedMs: number): string {
	const seconds = Math.round(elapsedMs / 1000);
	const label = status === 'queued' ? 'Waiting for a free GPU' : 'Generating mesh and textures';
	return `${label} (${seconds}s)`;
}

function recoveryFor(error: ForgeError | Error): string {
	const code = error instanceof ForgeError ? error.code : '';
	if (needsKey(error))
		return `Making a model needs a free three.ws account. Create an API key at ${API_KEYS_URL}, then paste it into the API Key field in the extension preferences.`;
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

function Generating({
	prompt,
	tier,
	standalone = false,
}: {
	prompt: string;
	tier: Tier;
	/** Launched straight from a command argument, so there is no form to pop back to. */
	standalone?: boolean;
}) {
	const { pop, push } = useNavigation();
	const editPrompt = standalone
		? () => push(<PromptForm initialPrompt={prompt} tier={tier} />)
		: pop;
	const client = useMemo(clientFromPreferences, []);
	const [status, setStatus] = useState('Submitting to Forge');
	const [result, setResult] = useState<ForgeResult | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		const run = client.hasApiKey
			? client.generate(prompt, tier, (s, elapsed) => setStatus(describeStatus(s, elapsed)))
			: Promise.reject(
					new ForgeError('No three.ws API key is set.', 'sign_in_required', 401),
				);
		run.then((r) => {
			setResult(r);
			return showToast({ style: Toast.Style.Success, title: 'Model ready' });
		}).catch((e: Error) => {
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
						{needsKey(error) ? (
							<>
								<Action
									title="Open Extension Preferences"
									onAction={openExtensionPreferences}
								/>
								<Action.OpenInBrowser
									title="Create an API Key"
									url={API_KEYS_URL}
								/>
							</>
						) : null}
						<Action title="Edit Prompt" icon={Icon.Pencil} onAction={editPrompt} />
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

function PromptForm({ initialPrompt, tier }: { initialPrompt: string; tier: Tier }) {
	const { push } = useNavigation();
	const [prompt, setPrompt] = useState(initialPrompt);
	const [promptError, setPromptError] = useState<string | undefined>();

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

export default function Command(props: LaunchProps<{ arguments: { prompt?: string } }>) {
	const tier: Tier = getPreferenceValues<Preferences>().tier ?? 'draft';
	const launchedPrompt = props.arguments.prompt?.trim() ?? '';

	// A prompt passed as the command argument (typed in root search, or sent by
	// Search 3D Assets / My Models) starts forging straight away.
	if (launchedPrompt.length >= 3) {
		return <Generating prompt={launchedPrompt} tier={tier} standalone />;
	}
	return <PromptForm initialPrompt={launchedPrompt} tier={tier} />;
}
