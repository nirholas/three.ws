import {
	Action,
	ActionPanel,
	Clipboard,
	Color,
	Detail,
	Icon,
	Keyboard,
	LaunchType,
	List,
	Toast,
	launchCommand,
	open,
	openExtensionPreferences,
	showToast,
} from '@raycast/api';
import { useCachedPromise, usePromise } from '@raycast/utils';
import { useMemo, useRef, useState } from 'react';
import { CatalogDetail, CatalogItem, CatalogKind, ForgeClient } from './forge-api';
import { clientFromPreferences, formatBytes } from './client';

type KindFilter = 'all' | CatalogKind;

const KIND_LABEL: Record<CatalogKind, string> = {
	object: 'Object',
	character: 'Rigged character',
	animation: 'Motion clip',
};
const KIND_ICON: Record<CatalogKind, Icon> = {
	object: Icon.Box,
	character: Icon.Person,
	animation: Icon.Play,
};
const FRAMEWORK_LABEL: Record<string, string> = {
	'model-viewer': '<model-viewer>',
	'agent-3d': '<agent-3d>',
	three: 'three.js',
	react: 'React',
};

function frameworkLabel(framework: string): string {
	return FRAMEWORK_LABEL[framework] ?? framework;
}

function licenseText(item: CatalogItem): string {
	return item.license ?? 'Not stated (check the preview page)';
}

function itemMarkdown(item: CatalogItem): string {
	if (item.thumb) return `![${item.title}](${item.thumb}?raycast-height=260)`;
	const glyph = item.icon ? `${item.icon} ` : '';
	const seconds = item.duration_seconds ? `, ${item.duration_seconds.toFixed(1)} s` : '';
	return `# ${glyph}${item.title}\n\nRetargetable motion clip${seconds}. It plays on any rigged humanoid as a \`THREE.AnimationClip\`.`;
}

function ItemDetail({ item }: { item: CatalogItem }) {
	const size = formatBytes(item.bytes);
	return (
		<List.Item.Detail
			markdown={itemMarkdown(item)}
			metadata={
				<List.Item.Detail.Metadata>
					<List.Item.Detail.Metadata.Label
						title="Kind"
						text={KIND_LABEL[item.kind]}
						icon={KIND_ICON[item.kind]}
					/>
					<List.Item.Detail.Metadata.Label title="License" text={licenseText(item)} />
					{size ? <List.Item.Detail.Metadata.Label title="Size" text={size} /> : null}
					{item.duration_seconds ? (
						<List.Item.Detail.Metadata.Label
							title="Duration"
							text={`${item.duration_seconds.toFixed(1)} s`}
						/>
					) : null}
					{item.rigged ? (
						<List.Item.Detail.Metadata.Label title="Rig" text="Humanoid skeleton" />
					) : null}
					{item.tags.length ? (
						<List.Item.Detail.Metadata.TagList title="Tags">
							{item.tags.slice(0, 8).map((tag) => (
								<List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
							))}
						</List.Item.Detail.Metadata.TagList>
					) : null}
					<List.Item.Detail.Metadata.Separator />
					<List.Item.Detail.Metadata.Label title="ID" text={item.id} />
				</List.Item.Detail.Metadata>
			}
		/>
	);
}

/** Every snippet for one asset, with a copy action per framework. */
function AssetSnippets({ item, client }: { item: CatalogItem; client: ForgeClient }) {
	const { data, isLoading, error, revalidate } = usePromise(
		(id: string) => client.catalogItem(id),
		[item.id],
	);

	if (error) {
		return (
			<Detail
				navigationTitle={item.title}
				markdown={`# Could not load the code for ${item.title}\n\n${error.message}\n\nCheck your connection or the API Base URL preference, then retry.`}
				actions={
					<ActionPanel>
						<Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
						<Action
							title="Open Extension Preferences"
							icon={Icon.Gear}
							onAction={openExtensionPreferences}
						/>
					</ActionPanel>
				}
			/>
		);
	}

	const markdown = data
		? [
				`# ${item.title}`,
				`License: ${licenseText(item)}`,
				...data.frameworks.map((framework) => {
					const snippet = data.snippets[framework];
					const notes = (snippet.notes ?? []).map((note) => `> ${note}`).join('\n>\n');
					return `## ${frameworkLabel(framework)}\n\n\`\`\`${snippet.language}\n${snippet.code}\n\`\`\`${notes ? `\n\n${notes}` : ''}`;
				}),
			].join('\n\n')
		: `# ${item.title}\n\nLoading paste-ready code...`;

	return (
		<Detail
			isLoading={isLoading}
			navigationTitle={item.title}
			markdown={markdown}
			actions={
				data ? (
					<ActionPanel>
						{data.frameworks.map((framework, index) => (
							<Action.CopyToClipboard
								key={framework}
								title={`Copy ${frameworkLabel(framework)} Code`}
								content={data.snippets[framework].code}
								shortcut={index === 0 ? Keyboard.Shortcut.Common.Copy : undefined}
							/>
						))}
						{data.links.preview ? (
							<Action.OpenInBrowser title="Open Preview" url={data.links.preview} />
						) : null}
						{data.links.ar ? (
							<Action.OpenInBrowser
								title="View in AR"
								icon={Icon.Mobile}
								url={data.links.ar}
							/>
						) : null}
						<Action.OpenInBrowser
							title="Download File"
							icon={Icon.Download}
							url={data.links.download ?? item.url}
						/>
					</ActionPanel>
				) : undefined
			}
		/>
	);
}

export default function Command() {
	const client = useMemo(clientFromPreferences, []);
	const [query, setQuery] = useState('');
	const [kind, setKind] = useState<KindFilter>('all');
	const [summary, setSummary] = useState<{ matched: number; total: number; relaxed: boolean }>();
	const details = useRef(new Map<string, CatalogDetail>());

	const { data, isLoading, error, pagination, revalidate } = useCachedPromise(
		(q: string, k: KindFilter) =>
			async ({ cursor }: { page: number; cursor?: number }) => {
				const page = await client.searchCatalog({
					query: q,
					kind: k === 'all' ? undefined : k,
					offset: cursor ?? 0,
				});
				if (!cursor) {
					setSummary({ matched: page.matched, total: page.total, relaxed: page.relaxed });
				}
				return {
					data: page.items,
					hasMore: page.nextOffset !== null,
					cursor: page.nextOffset ?? undefined,
				};
			},
		[query, kind],
		{
			keepPreviousData: true,
			failureToastOptions: { title: 'Catalog search failed' },
		},
	);

	async function detailFor(item: CatalogItem): Promise<CatalogDetail> {
		const cached = details.current.get(item.id);
		if (cached) return cached;
		const detail = await client.catalogItem(item.id);
		details.current.set(item.id, detail);
		return detail;
	}

	async function copyDefaultSnippet(item: CatalogItem) {
		const toast = await showToast({ style: Toast.Style.Animated, title: 'Fetching code' });
		try {
			const detail = await detailFor(item);
			const framework = detail.frameworks[0];
			if (!framework) throw new Error('This asset has no code snippet.');
			await Clipboard.copy(detail.snippets[framework].code);
			toast.style = Toast.Style.Success;
			toast.title = `${frameworkLabel(framework)} code copied`;
			toast.message = `License: ${licenseText(item)}`;
		} catch (e) {
			toast.style = Toast.Style.Failure;
			toast.title = 'Could not fetch the code';
			toast.message = e instanceof Error ? e.message : String(e);
		}
	}

	async function openPreview(item: CatalogItem) {
		try {
			const detail = await detailFor(item);
			await open(detail.links.preview ?? detail.links.browse ?? item.url);
		} catch (e) {
			await showToast({
				style: Toast.Style.Failure,
				title: 'Could not open the preview',
				message: e instanceof Error ? e.message : String(e),
			});
		}
	}

	function forgeInstead(prompt: string) {
		return launchCommand({
			name: 'forge-model',
			type: LaunchType.UserInitiated,
			arguments: { prompt },
		});
	}

	const items = data ?? [];
	const trimmed = query.trim();
	const sectionTitle = summary?.relaxed
		? `No exact match for "${trimmed}". Closest results`
		: trimmed
			? 'Matches'
			: 'Browse';
	const sectionSubtitle = summary
		? trimmed
			? `${summary.matched.toLocaleString()} of ${summary.total.toLocaleString()}`
			: `${summary.matched.toLocaleString()} assets`
		: undefined;

	return (
		<List
			isLoading={isLoading}
			isShowingDetail={items.length > 0}
			filtering={false}
			throttle
			pagination={pagination}
			onSearchTextChange={setQuery}
			searchBarPlaceholder="Search free 3D props, rigged characters and motion clips"
			searchBarAccessory={
				<List.Dropdown
					tooltip="Asset kind"
					value={kind}
					onChange={(value) => setKind(value as KindFilter)}
				>
					<List.Dropdown.Item title="All Kinds" value="all" />
					<List.Dropdown.Item title="Objects" value="object" icon={Icon.Box} />
					<List.Dropdown.Item title="Characters" value="character" icon={Icon.Person} />
					<List.Dropdown.Item title="Animations" value="animation" icon={Icon.Play} />
				</List.Dropdown>
			}
		>
			{error && !items.length ? (
				<List.EmptyView
					icon={{ source: Icon.Warning, tintColor: Color.Red }}
					title="Could not reach the three.ws catalog"
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
					icon={Icon.MagnifyingGlass}
					title={trimmed ? `No assets match "${trimmed}"` : 'Search the three.ws catalog'}
					description={
						trimmed
							? 'Try fewer words or another kind, or forge the model from your prompt.'
							: 'Type what you need, for example: wooden chair, robot, wave.'
					}
					actions={
						trimmed ? (
							<ActionPanel>
								<Action
									title={`Forge "${trimmed}"`}
									icon={Icon.Hammer}
									onAction={() => forgeInstead(trimmed)}
								/>
								{kind !== 'all' ? (
									<Action
										title="Search All Kinds"
										icon={Icon.MagnifyingGlass}
										onAction={() => setKind('all')}
									/>
								) : null}
							</ActionPanel>
						) : undefined
					}
				/>
			)}
			<List.Section title={sectionTitle} subtitle={sectionSubtitle}>
				{items.map((item) => (
					<List.Item
						key={item.id}
						id={item.id}
						title={item.title}
						icon={item.thumb ? { source: item.thumb } : KIND_ICON[item.kind]}
						keywords={item.tags}
						detail={<ItemDetail item={item} />}
						actions={
							<ActionPanel>
								<ActionPanel.Section>
									<Action
										title="Copy Embed Code"
										icon={Icon.Code}
										onAction={() => copyDefaultSnippet(item)}
									/>
									<Action
										title="Open Preview"
										icon={Icon.Globe}
										onAction={() => openPreview(item)}
									/>
									<Action.Push
										title="Show All Code Snippets"
										icon={Icon.CodeBlock}
										shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
										target={<AssetSnippets item={item} client={client} />}
									/>
								</ActionPanel.Section>
								<ActionPanel.Section>
									<Action.CopyToClipboard
										title="Copy File URL"
										content={item.url}
										shortcut={Keyboard.Shortcut.Common.CopyPath}
									/>
									<Action.OpenInBrowser
										title="Download File"
										icon={Icon.Download}
										url={item.url}
										shortcut={{ modifiers: ['cmd'], key: 'd' }}
									/>
								</ActionPanel.Section>
								<ActionPanel.Section>
									<Action
										title={
											trimmed
												? `Forge "${trimmed}" Instead`
												: 'Forge a 3D Model'
										}
										icon={Icon.Hammer}
										shortcut={Keyboard.Shortcut.Common.New}
										onAction={() => forgeInstead(trimmed)}
									/>
								</ActionPanel.Section>
							</ActionPanel>
						}
					/>
				))}
			</List.Section>
		</List>
	);
}
