// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

import chalk from 'chalk';
import ora from 'ora';
import { promptInit } from '../prompts';
import { writeConfigFile, getDefaults } from '../config';
import { banner, success, error, spacer } from '../logger';
import type { AgentConfig } from '../config';

export async function initCommand(options: { config: string }): Promise<void> {
  banner();
  console.log(chalk.bold('  Setup Wizard'));
  spacer();

  try {
    const answers = await promptInit();

    const config: AgentConfig = {
      ...getDefaults(),
      ai: {
        provider: answers.provider,
        apiKey: answers.apiKey,
        systemPrompt: answers.systemPrompt,
      },
      voice: {
        provider: answers.ttsProvider,
        ...(answers.ttsApiKey ? { apiKey: answers.ttsApiKey } : {}),
      },
    };

    const spinner = ora('Saving configuration...').start();

    const configPath = options.config || 'xspace.config.json';
    writeConfigFile(configPath, config);

    spinner.succeed('Configuration saved');
    spacer();
    success(`Config saved to ${chalk.cyan(configPath)}`);
    spacer();
    console.log(`  Run: ${chalk.cyan('npx xspace-agent auth')} to authenticate with X`);
    console.log(`  Then: ${chalk.cyan('npx xspace-agent start')} to launch`);
    spacer();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error('Setup failed:', message);
    process.exit(1);
  }
}


