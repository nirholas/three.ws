import TestDriver from '@airtable/blocks-testing';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgeApp from '../frontend/ForgeApp.jsx';
import baseFixture, { LAMP_GLB } from './fixtures/base.js';
import { exchange, instantSleep, replayFetch } from './replay.js';

const KEY = 'sk_live_fixture-key-not-real-000000';
const done = exchange.polls.at(-1).body;

let driver;
let mutations;

function mount(fetchSetup = replayFetch()) {
	render(
		<driver.Container>
			<ForgeApp clientOptions={{ fetchImpl: fetchSetup.fetchImpl, sleep: instantSleep }} />
		</driver.Container>,
	);
	return fetchSetup;
}

async function configure(extra = {}) {
	await driver.globalConfig.setPathsAsync(
		Object.entries({
			tableId: 'tblProducts',
			viewId: 'viwAll',
			promptFieldId: 'fldPrompt',
			modelFieldId: 'fldModel',
			linkFieldId: 'fldPage',
			statusFieldId: 'fldStatus',
			tier: 'draft',
			...extra,
		}).map(([key, value]) => ({ path: [key], value })),
	);
}

const recordUpdates = () =>
	mutations.filter((m) => m.type === 'setMultipleRecordsCellValues').flatMap((m) => m.records);

beforeEach(() => {
	window.localStorage.clear();
	driver = new TestDriver(baseFixture);
	mutations = [];
	driver.watch('mutation', (m) => mutations.push(m));
});

afterEach(cleanup);

describe('settings', () => {
	it('asks for the mapping and a key before anything else', async () => {
		mount();
		expect(screen.getByText('Set up Forge')).toBeTruthy();
		expect(screen.getByRole('status').textContent).toMatch(/Pick the table/);
		expect(screen.getByRole('button', { name: 'Done' }).disabled).toBe(true);
	});

	it('rejects a value that is not a three.ws key without saving it', async () => {
		await configure();
		mount();
		userEvent.type(screen.getByLabelText('API key'), 'not-a-key');
		userEvent.click(screen.getByRole('button', { name: 'Save key' }));
		expect(screen.getByText(/start with sk_live_/)).toBeTruthy();
		expect(window.localStorage.getItem('three-ws:forge:api-key')).toBeNull();
	});

	it('saves the key in this browser only and opens the generator', async () => {
		await configure();
		mount();
		userEvent.type(screen.getByLabelText('API key'), KEY);
		userEvent.click(screen.getByRole('button', { name: 'Save key' }));
		expect(window.localStorage.getItem('three-ws:forge:api-key')).toBe(KEY);
		expect(driver.globalConfig.get('apiKey')).toBeUndefined();
		// The mapping was already complete, so saving the key is the last step.
		await screen.findByText('Forge 3D models');
	});
});

describe('generator', () => {
	beforeEach(async () => {
		await configure();
		window.localStorage.setItem('three-ws:forge:api-key', KEY);
	});

	it('lists only records with a usable prompt and counts the ones without a model', async () => {
		mount();
		await screen.findByText('Forge 3D models');
		expect(screen.getByText('a ceramic teapot with a bamboo handle')).toBeTruthy();
		expect(screen.getByText('a brass desk lamp with a green glass shade')).toBeTruthy();
		expect(screen.queryByText('ab')).toBeNull();
		expect(screen.getByText('1 of 2 records with a prompt have a model.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Generate 1 model' }).disabled).toBe(false);
	});

	it('shows the stored model poster as its thumbnail, falling back to a cube when there is none', async () => {
		mount();
		await screen.findByText('Forge 3D models');
		const poster = document.querySelector('img');
		expect(poster.getAttribute('src')).toBe('https://three.ws/api/forge/420980dd-1c07-4830-b0db-0eacd12cf6de/og');
		fireEvent.error(poster);
		expect(document.querySelector('img')).toBeNull();
	});

	it('says every model is generated instead of offering to generate zero', async () => {
		mount(replayFetch({ cached: true }));
		await screen.findByText('Forge 3D models');
		userEvent.click(screen.getByRole('button', { name: 'Generate 1 model' }));
		await screen.findByText('2 of 2 records with a prompt have a model.');
		const all = screen.getByRole('button', { name: 'All models generated' });
		expect(all.disabled).toBe(true);
		expect(screen.queryByText(/Generate 0 models/)).toBeNull();
	});

	it('generates a model and writes the GLB, its 3D page and the status into the record', async () => {
		const { calls } = mount();
		await screen.findByText('Forge 3D models');
		userEvent.click(screen.getByRole('button', { name: 'Generate 1 model' }));

		await waitFor(() => expect(recordUpdates()).toHaveLength(1));
		const [update] = recordUpdates();
		expect(update.id).toBe('recTeapot');
		expect(update.cellValuesByFieldId).toEqual({
			fldModel: [{ url: done.glb_url, filename: 'a-ceramic-teapot-with-a-bamboo-handle.glb' }],
			fldPage: `https://three.ws/m/${done.creation_id}`,
			fldStatus: 'Done',
		});
		expect(calls[0].body.prompt).toBe('a ceramic teapot with a bamboo handle');
		expect(calls.some((c) => c.body?.prompt === 'a brass desk lamp with a green glass shade')).toBe(false);
		await screen.findByText('2 of 2 records with a prompt have a model.');
	});

	it('regenerates a selected record by appending to its attachment cell, keeping the old file', async () => {
		driver.setActiveCursorModels({ table: 'tblProducts', view: 'viwAll' });
		driver.userSelectRecords(['recLamp']);
		mount(replayFetch({ cached: true }));
		await screen.findByText('Forge 3D models');
		userEvent.click(screen.getByRole('button', { name: 'Generate selected (1)' }));
		await waitFor(() => expect(recordUpdates()).toHaveLength(1));
		const [update] = recordUpdates();
		expect(update.id).toBe('recLamp');
		expect(update.cellValuesByFieldId.fldModel).toEqual([
			{ id: 'attLamp', url: LAMP_GLB, filename: 'lamp.glb' },
			{ url: done.glb_url, filename: 'a-brass-desk-lamp-with-a-green-glass-shade.glb' },
		]);
	});

	it('writes the failure reason to the status field and offers a retry', async () => {
		const failing = replayFetch({
			script: [exchange.submit, { status: 200, body: { status: 'failed', error: 'The image step could not find one object.' } }],
		});
		mount(failing);
		await screen.findByText('Forge 3D models');
		userEvent.click(screen.getByRole('button', { name: 'Generate 1 model' }));
		await screen.findByText('The image step could not find one object.');
		expect(recordUpdates()).toEqual([
			{ id: 'recTeapot', cellValuesByFieldId: { fldStatus: 'Failed: The image step could not find one object.' } },
		]);
		expect(screen.getByRole('button', { name: 'Retry: a ceramic teapot with a bamboo handle' })).toBeTruthy();
	});

	it('asks for a new key when three.ws rejects the saved one', async () => {
		mount(replayFetch({ script: [exchange.unauthorized] }));
		await screen.findByText('Forge 3D models');
		userEvent.click(screen.getByRole('button', { name: 'Generate 1 model' }));
		await screen.findByText(/did not accept this key/);
		expect(screen.getByLabelText('API key')).toBeTruthy();
	});

	it('disables generating for someone who cannot edit the mapped fields', async () => {
		driver.simulatePermissionCheck((mutation) => mutation.type !== 'setMultipleRecordsCellValues');
		mount();
		await screen.findByText('Forge 3D models');
		expect(screen.getByRole('button', { name: 'Generate 1 model' }).disabled).toBe(true);
		expect(screen.getAllByRole('status').some((n) => n.textContent.length > 0)).toBe(true);
	});

	it('generates just the selected records that have a prompt', async () => {
		driver.setActiveCursorModels({ table: 'tblProducts', view: 'viwAll' });
		driver.userSelectRecords(['recTeapot', 'recBlank']);
		const { calls } = mount(replayFetch({ cached: true }));
		await screen.findByText('Forge 3D models');
		userEvent.click(screen.getByRole('button', { name: 'Generate selected (1)' }));
		await waitFor(() => expect(recordUpdates()).toHaveLength(1));
		expect(recordUpdates()[0].id).toBe('recTeapot');
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
	});
});

describe('empty state', () => {
	it('explains how to add a prompt when no record has one', async () => {
		await configure({ promptFieldId: 'fldStatus', statusFieldId: null });
		window.localStorage.setItem('three-ws:forge:api-key', KEY);
		mount();
		await screen.findByText(/None of the 4 records has a prompt in "Status" yet/);
		expect(screen.getByRole('button', { name: 'No prompts yet' }).disabled).toBe(true);
	});
});
