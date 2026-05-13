// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§68]

import chalk from 'chalk';
import ora from 'ora';
import { resolveConfig, configToEnv } from '../config';
import { banner, success, error, label, spacer } from '../logger';

interface StartOptions {
  config: string;
  port: string;
  headless?: boolean;
  verbose?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  banner();

  // Load config and apply to env
  require('dotenv').config();
  const config = resolveConfig(options.config, {});
  configToEnv(config);

  const port = parseInt(options.port, 10) || 3000;

  const spinner = ora('Starting server...').start();

  try {
    const { createServer } = await import('@xspace/server');

    const server = createServer({
      port,
      headless: options.headless,
      verbose: options.verbose,
    });

    await server.start();

    spinner.succeed('Server running');
    spacer();
    label('Admin panel', `http://localhost:${port}/admin`);
    label('Dashboard', `http://localhost:${port}`);
    label('AI Provider', config.ai.provider);
    spacer();
    console.log(`  ${chalk.gray('Waiting for Space URL...')}`);
    console.log(`  ${chalk.gray('Use the admin panel or run:')} ${chalk.cyan(`npx xspace-agent join <url>`)}`);
    spacer();

    // Keep process alive with graceful shutdown
    const shutdown = async () => {
      spacer();
      await server.stop();
      success('Server stopped');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err: unknown) {
    spinner.fail('Failed to start server');
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(1);
  }
}


