import React, { useState } from 'react';
import { Box, Button, FormField, Heading, Input, Link, Text } from '@airtable/blocks/ui';
import { apiKeyProblem, clearApiKey, isPersistent, saveApiKey } from './api-key.js';
import { API_KEYS_URL } from './forge-client.js';

function masked(key) {
	return `${key.slice(0, 12)}…${key.slice(-4)}`;
}

export default function ApiKeyForm({ apiKey, onChange, rejected = false }) {
	const [draft, setDraft] = useState('');
	const [touched, setTouched] = useState(false);
	const [editing, setEditing] = useState(!apiKey || rejected);
	const problem = apiKeyProblem(draft);
	const persistent = isPersistent();

	function save(event) {
		event.preventDefault();
		setTouched(true);
		if (problem) return;
		onChange(saveApiKey(draft));
		setDraft('');
		setTouched(false);
		setEditing(false);
	}

	function remove() {
		clearApiKey();
		onChange('');
		setEditing(true);
	}

	return (
		<Box>
			<Heading size="xsmall" marginBottom={1}>
				three.ws API key
			</Heading>
			<Text textColor="light" marginBottom={2}>
				Generating is free, but every model needs an owner. Create a free key at{' '}
				<Link href={API_KEYS_URL} target="_blank" rel="noopener noreferrer">
					three.ws/dashboard/api
				</Link>
				. It stays in this browser and is only sent to three.ws. Models you make belong to your three.ws account
				and stay unlisted until you publish them.
			</Text>

			{rejected && (
				<Box backgroundColor="redLight2" borderRadius="large" padding={2} marginBottom={2} role="alert">
					<Text textColor="red">three.ws did not accept this key. It may have been revoked. Paste a new one.</Text>
				</Box>
			)}

			{!editing && apiKey ? (
				<Box display="flex" alignItems="center">
					<Text marginRight={2}>
						Key saved {persistent ? 'in this browser' : 'for this session'}: <code>{masked(apiKey)}</code>
					</Text>
					<Button size="small" variant="secondary" onClick={() => setEditing(true)} marginRight={1}>
						Replace
					</Button>
					<Button size="small" variant="secondary" onClick={remove}>
						Remove
					</Button>
				</Box>
			) : (
				<form onSubmit={save}>
					<FormField
						label="API key"
						description={
							touched && problem
								? problem
								: persistent
									? 'Each collaborator adds their own key.'
									: 'This browser blocks storage for extensions, so the key is kept until you close the base.'
						}
						marginBottom={2}
					>
						<Input
							type="password"
							autoComplete="off"
							spellCheck={false}
							placeholder="sk_live_…"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onBlur={() => setTouched(Boolean(draft))}
						/>
					</FormField>
					<Button type="submit" variant="primary" size="small" disabled={!draft.trim()}>
						Save key
					</Button>
					{apiKey && !rejected && (
						<Button type="button" size="small" variant="secondary" marginLeft={1} onClick={() => setEditing(false)}>
							Cancel
						</Button>
					)}
				</form>
			)}
		</Box>
	);
}
