import { getPreferenceValues } from '@raycast/api';
import { randomUUID } from 'node:crypto';
import { ForgeClient, Tier } from './forge-api';

export interface Preferences {
	apiKey?: string;
	tier?: Tier;
	baseUrl?: string;
}

/** A client built from the extension preferences. */
export function clientFromPreferences(): ForgeClient {
	const preferences = getPreferenceValues<Preferences>();
	return new ForgeClient({
		baseUrl: preferences.baseUrl,
		apiKey: preferences.apiKey,
		clientHandle: `raycast-${randomUUID()}`,
	});
}

export function formatBytes(bytes?: number): string | undefined {
	if (!bytes || bytes <= 0) return undefined;
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
