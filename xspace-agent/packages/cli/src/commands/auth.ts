// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§66]

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { promptAuth } from '../prompts';
import { banner, success, error, spacer } from '../logger';

export async function authCommand(options: { config: string }): Promise<void> {
  banner();
  console.log(chalk.bold('  X Authentication'));
  spacer();

  try {
    const authAnswers = await promptAuth();

    if (authAnswers.method === 'token') {
      const envPath = path.resolve('.env');
      let envContent = '';

      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }

      // Update or append X_AUTH_TOKEN
      if (envContent.includes('X_AUTH_TOKEN=')) {
        envContent = envContent.replace(
          /X_AUTH_TOKEN=.*/,
          `X_AUTH_TOKEN=${authAnswers.authToken}`
        );
      } else {
        envContent += `${envContent && !envContent.endsWith('\n') ? '\n' : ''}X_AUTH_TOKEN=${authAnswers.authToken}\n`;
      }

      fs.writeFileSync(envPath, envContent, 'utf-8');

      const spinner = ora('Verifying authentication...').start();

      if (authAnswers.authToken && authAnswers.authToken.length > 10) {
        spinner.succeed('Auth token saved');
        spacer();
        success('auth_token saved to .env');
        console.log(`  ${chalk.gray('Token will be verified when joining a Space')}`);
      } else {
        spinner.fail('Token looks too short');
        error('The auth_token seems invalid. Get a fresh one from browser DevTools.');
        process.exit(1);
      }
    } else {
      // Username/password flow
      const envPath = path.resolve('.env');
      let envContent = '';

      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }

      const setEnvVar = (content: string, key: string, value: string): string => {
        if (content.includes(`${key}=`)) {
          return content.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
        }
        return content + `${content && !content.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
      };

      envContent = setEnvVar(envContent, 'X_USERNAME', authAnswers.username!);
      envContent = setEnvVar(envContent, 'X_PASSWORD', authAnswers.password!);

      fs.writeFileSync(envPath, envContent, 'utf-8');

      success('Credentials saved to .env');
      console.log(`  ${chalk.gray('Login will happen when joining a Space')}`);
    }

    spacer();
    console.log(`  Next: ${chalk.cyan('npx xspace-agent join <space-url>')}`);
    spacer();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error('Authentication failed:', message);
    process.exit(1);
  }
}


