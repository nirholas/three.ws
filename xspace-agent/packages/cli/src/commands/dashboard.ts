// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§85]

import * as path from 'path';
import * as http from 'http';
import chalk from 'chalk';
import ora from 'ora';
import express from 'express';
import { banner, success, error, label, spacer } from '../logger';
import { resolveFromRoot } from '../paths';

interface DashboardOptions {
  port: string;
}

export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  banner();

  const port = parseInt(options.port, 10) || 3000;
  const spinner = ora('Starting dashboard...').start();

  try {
    const app = express();
    const server = http.createServer(app);

    // Serve the static public directory using package-anchored resolution
    const publicDir = resolveFromRoot('public');
    app.use(express.static(publicDir));

    app.get('/', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });

    app.get('/admin', (_req, res) => {
      res.sendFile(path.join(publicDir, 'admin.html'));
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(port, () => resolve());
      server.on('error', reject);
    });

    spinner.succeed('Dashboard running');
    spacer();
    label('Dashboard', `http://localhost:${port}`);
    spacer();
    console.log(`  ${chalk.gray('Press Ctrl+C to stop')}`);
    spacer();

    process.on('SIGINT', () => {
      server.close();
      spacer();
      success('Dashboard stopped');
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      server.close();
      process.exit(0);
    });
  } catch (err: unknown) {
    spinner.fail('Failed to start dashboard');
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(1);
  }
}


