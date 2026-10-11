import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalApiServer } from './local-api-server.mjs';

async function listen(server, host = '127.0.0.1', port = 0) {
  await new Promise((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, host);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }
  return address.port;
}

async function setupRemoteServer() {
  const hits = [];
  const origins = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    hits.push(url.pathname);
    origins.push(req.headers.origin || null);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      source: 'remote',
      path: url.pathname,
      origin: req.headers.origin || null,
    }));
  });

  const port = await listen(server);
  return {
    hits,
    origins,
    remoteBase: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function setupApiDir(files) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wm-sidecar-test-'));
  const apiDir = path.join(tempRoot, 'api');
  await mkdir(apiDir, { recursive: true });

  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const absolute = path.join(apiDir, relativePath);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, source, 'utf8');
    })
  );

  return {
    apiDir,
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function setupResourceDirWithUpApi(files) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wm-sidecar-resource-test-'));
  const apiDir = path.join(tempRoot, '_up_', 'api');
  await mkdir(apiDir, { recursive: true });

  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const absolute = path.join(apiDir, relativePath);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, source, 'utf8');
    })
  );

  return {
    resourceDir: tempRoot,
    apiDir,
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

test('returns local error directly when cloudFallback is off (default)', async () => {
  const remote = await setupRemoteServer();
  const localApi = await setupApiDir({
    'earthquakes.js': `
      export default async function handler() {
        return new Response(JSON.stringify({ source: 'local-error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    `,
  });

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    remoteBase: remote.remoteBase,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/earthquakes`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.source, 'local-error');
    assert.equal(remote.hits.length, 0);
  } finally {
    await app.close();
    await localApi.cleanup();
    await remote.close();
  }
});

test('falls back to cloud when cloudFallback is enabled and local handler returns 500', async () => {
  const remote = await setupRemoteServer();
  const localApi = await setupApiDir({
    'earthquakes.js': `
      export default async function handler() {
        return new Response(JSON.stringify({ source: 'local-error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    `,
  });

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    remoteBase: remote.remoteBase,
    cloudFallback: 'true',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/earthquakes`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'remote');
    assert.equal(remote.hits.includes('/api/earthquakes'), true);
  } finally {
    await app.close();
    await localApi.cleanup();
    await remote.close();
  }
});

test('uses local handler response when local handler succeeds', async () => {
  const remote = await setupRemoteServer();
  const localApi = await setupApiDir({
    'live.js': `
      export default async function handler() {
        return new Response(JSON.stringify({ source: 'local-ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    `,
  });

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    remoteBase: remote.remoteBase,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/live`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'local-ok');
    assert.equal(remote.hits.length, 0);
  } finally {
    await app.close();
    await localApi.cleanup();
    await remote.close();
  }
});

test('returns 404 when local route does not exist and cloudFallback is off', async () => {
  const remote = await setupRemoteServer();
  const localApi = await setupApiDir({});

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    remoteBase: remote.remoteBase,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/not-found`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'No local handler for this endpoint');
    assert.equal(remote.hits.length, 0);
  } finally {
    await app.close();
    await localApi.cleanup();
    await remote.close();
  }
});

test('strips browser origin headers before invoking local handlers', async () => {
  const remote = await setupRemoteServer();
  const localApi = await setupApiDir({
    'origin-check.js': `
      export default async function handler(req) {
        const origin = req.headers.get('origin');
        return new Response(JSON.stringify({
          source: 'local',
          originPresent: Boolean(origin),
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    `,
  });

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    remoteBase: remote.remoteBase,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/origin-check`, {
      headers: { Origin: 'https://tauri.localhost' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'local');
    assert.equal(body.originPresent, false);
    assert.equal(remote.hits.length, 0);
  } finally {
    await app.close();
    await localApi.cleanup();
    await remote.close();
  }
});

test('strips browser origin headers when proxying to cloud fallback (cloudFallback enabled)', async () => {
  const remote = await setupRemoteServer();
  const localApi = await setupApiDir({});

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    remoteBase: remote.remoteBase,
    cloudFallback: 'true',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/no-local-handler`, {
      headers: { Origin: 'https://tauri.localhost' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'remote');
    assert.equal(body.origin, null);
    assert.equal(remote.origins[0], null);
  } finally {
    await app.close();
    await localApi.cleanup();
    await remote.close();
  }
});

test('responds to OPTIONS preflight with CORS headers', async () => {
  const localApi = await setupApiDir({
    'data.js': `
      export default async function handler() {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
    `,
  });

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/data`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, PUT, DELETE, OPTIONS');
  } finally {
    await app.close();
    await localApi.cleanup();
  }
});

test('resolves packaged tauri resource layout under _up_/api', async () => {
  const remote = await setupRemoteServer();
  const localResource = await setupResourceDirWithUpApi({
    'live.js': `
      export default async function handler() {
        return new Response(JSON.stringify({ source: 'local-up' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    `,
  });

  const app = await createLocalApiServer({
    port: 0,
    resourceDir: localResource.resourceDir,
    remoteBase: remote.remoteBase,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    assert.equal(app.context.apiDir, localResource.apiDir);
    assert.equal(app.routes.length, 1);

    const response = await fetch(`http://127.0.0.1:${port}/api/live`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'local-up');
    assert.equal(remote.hits.length, 0);
  } finally {
    await app.close();
    await localResource.cleanup();
    await remote.close();
  }
});
