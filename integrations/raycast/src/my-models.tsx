import {
	Action,
	ActionPanel,
	Color,
	Icon,
	Keyboard,
	LaunchType,
	List,
	launchCommand,
	openExtensionPreferences,
	showToast,
	Toast,
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { useMemo } from 'react';
import { API_KEYS_URL, MyModel, needsApiKey } from './forge-api';
import { clientFromPreferences } from './client';

const VISIBILITY: Record<MyModel['visibility'], { label: string; color: Color; note: string }> = {
	public: { label: 'Public', color: Color.Green, note: 'Listed in the public gallery.' },
	unlisted: {
		label: 'Unlisted',
		color: Color.Orange,
		note: 'Anyone with the link can open it. Publish it from the model page.',
	},
	private: { label: 'Private', color: Color.SecondaryText, note: 'Only you can open it.' },
};

function forge(prompt: string) {
	return launchCommand({
		name: 'forge-model',
		type: LaunchType.UserInitiated,
		arguments: { prompt },
	});
}

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function ModelDetail({ model }: { model: MyModel }) {
	const visibility = VISIBILITY[model.visibility];
	const image = model.previewImageUrl
		? `![${model.title}](${model.previewImageUrl}?raycast-height=260)\n\n`
		: '';
	return (
		<List.Item.Detail
			markdown={`${image}${model.prompt}`}
			metadata={
				<List.Item.Detail.Metadata>
					<List.Item.Detail.Metadata.TagList title="Visibility">
						<List.Item.Detail.Metadata.TagList.Item
							text={visibility.label}
							color={visibility.color}
						/>
					</List.Item.Detail.Metadata.TagList>
					<List.Item.Detail.Metadata.Label title="" text={visibility.note} />
					<List.Item.Detail.Metadata.Label
						title="Created"
						text={formatDate(model.createdAt)}
					/>
					<List.Item.Detail.Metadata.Link
						title="Model Page"
						target={model.modelUrl}
						text="Open on three.ws"
					/>
				</List.Item.Detail.Metadata>
			}
		/>
	);
}

export default function Command() {
	const client = useMemo(clientFromPreferences, []);
	const { data, isLoading, error, pagination, revalidate } = usePromise(
		() =>
			async ({ cursor }: { page: number; cursor?: string }) => {
				const page = await client.listMyModels({ before: cursor });
				return {
					data: page.models,
					hasMore: page.nextBefore !== null,
					cursor: page.nextBefore ?? undefined,
				};
			},
		[],
		{
			onError: (e) => {
				// A missing or revoked key gets its own empty view with the fix; no toast on top.
				if (needsApiKey(e)) return;
				showToast({
					style: Toast.Style.Failure,
					title: 'Could not load your models',
					message: e.message,
				});
			},
		},
	);

	const models = data ?? [];
	const keyActions = (
		<ActionPanel>
			<Action
				title="Open Extension Preferences"
				icon={Icon.Gear}
				onAction={openExtensionPreferences}
			/>
			<Action.OpenInBrowser title="Create an API Key" icon={Icon.Key} url={API_KEYS_URL} />
		</ActionPanel>
	);

	return (
		<List
			isLoading={isLoading}
			isShowingDetail={models.length > 0}
			pagination={pagination}
			searchBarPlaceholder="Filter your Forge models by prompt"
		>
			{error && needsApiKey(error) ? (
				<List.EmptyView
					icon={Icon.Key}
					title="Connect your three.ws account"
					description={`${error.message}\nCreate a free API key at three.ws, then paste it into the API Key field in the extension preferences.`}
					actions={keyActions}
				/>
			) : error ? (
				<List.EmptyView
					icon={{ source: Icon.Warning, tintColor: Color.Red }}
					title="Could not load your models"
					description={`${error.message}\nCheck your connection or the API Base URL preference, then retry.`}
					actions={
						<ActionPanel>
							<Action
								title="Retry"
								icon={Icon.ArrowClockwise}
								onAction={revalidate}
							/>
							<Action
								title="Open Extension Preferences"
								icon={Icon.Gear}
								onAction={openExtensionPreferences}
							/>
						</ActionPanel>
					}
				/>
			) : (
				<List.EmptyView
					icon={Icon.Hammer}
					title="No models yet"
					description="Forge your first model from a prompt and it shows up here, newest first."
					actions={
						<ActionPanel>
							<Action
								title="Forge a 3D Model"
								icon={Icon.Hammer}
								onAction={() => forge('')}
							/>
						</ActionPanel>
					}
				/>
			)}
			{models.map((model) => (
				<List.Item
					key={model.id}
					id={model.id}
					title={model.title}
					icon={model.previewImageUrl ? { source: model.previewImageUrl } : Icon.Box}
					keywords={model.prompt.split(/\s+/).filter(Boolean)}
					detail={<ModelDetail model={model} />}
					actions={
						<ActionPanel>
							<ActionPanel.Section>
								<Action.OpenInBrowser
									title="Open Model Page"
									url={model.modelUrl}
								/>
								<Action.CopyToClipboard
									title="Copy Model Link"
									content={model.modelUrl}
									shortcut={Keyboard.Shortcut.Common.Copy}
								/>
								<Action.CopyToClipboard
									title="Copy Prompt"
									content={model.prompt}
									shortcut={Keyboard.Shortcut.Common.CopyName}
								/>
							</ActionPanel.Section>
							<ActionPanel.Section>
								<Action
									title="Forge Again with This Prompt"
									icon={Icon.Hammer}
									shortcut={{ modifiers: ['cmd'], key: 'f' }}
									onAction={() => forge(model.prompt)}
								/>
								<Action
									title="Forge a New Model"
									icon={Icon.PlusCircle}
									shortcut={Keyboard.Shortcut.Common.New}
									onAction={() => forge('')}
								/>
								<Action
									title="Refresh"
									icon={Icon.ArrowClockwise}
									shortcut={Keyboard.Shortcut.Common.Refresh}
									onAction={revalidate}
								/>
							</ActionPanel.Section>
						</ActionPanel>
					}
				/>
			))}
		</List>
	);
}
