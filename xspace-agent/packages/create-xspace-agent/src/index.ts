// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import Handlebars from 'handlebars';

// ── Types ───────────────────────────────────────────────────────────────────

interface ProjectOptions {
  name: string;
  provider: 'openai' | 'claude' | 'groq';
  typescript: boolean;
  template: 'basic' | 'multi-agent' | 'server';
  includeExamples: boolean;
}

interface TemplateContext {
  projectName: string;
  provider: string;
  typescript: boolean;
  providerEnvKey: string;
  defaultModel: string;
}

// ── Provider Helpers ────────────────────────────────────────────────────────

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
};

const PROVIDER_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-sonnet-4-20250514',
  groq: 'llama-3.3-70b-versatile',
};

// ── CLI ─────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('create-xspace-agent')
  .description('Scaffold a new xspace-agent project')
  .version('0.1.0')
  .argument('[project-name]', 'Name of the project')
  .option('-p, --provider <provider>', 'AI provider (openai, claude, groq)')
  .option('--ts', 'Use TypeScript (default)')
  .option('--js', 'Use JavaScript')
  .option('-t, --template <template>', 'Template (basic, multi-agent, server)')
  .option('--no-install', 'Skip npm install')
  .action(async (projectName?: string, opts?: Record<string, unknown>) => {
    console.log();
    console.log(chalk.bold('  🎙️  Create X Space Agent'));
    console.log();

    try {
      const options = await gatherOptions(projectName, opts ?? {});
      await createProject(options, opts?.install !== false);
    } catch (err) {
      if ((err as { isTtyError?: boolean }).isTtyError) {
        console.error(chalk.red('✗'), 'Interactive prompts not supported in this terminal.');
        process.exit(1);
      }
      if ((err as Error).message?.includes('User force closed')) {
        console.log();
        console.log(chalk.yellow('Cancelled.'));
        process.exit(0);
      }
      console.error(chalk.red('✗'), (err as Error).message || err);
      process.exit(1);
    }
  });

program.parse();

// ── Prompt & Gather ─────────────────────────────────────────────────────────

async function gatherOptions(
  projectNameArg: string | undefined,
  flags: Record<string, unknown>,
): Promise<ProjectOptions> {
  const questions: Array<Record<string, unknown>> = [];

  if (!projectNameArg) {
    questions.push({
      type: 'input',
      name: 'name',
      message: 'Project name:',
      default: 'my-agent',
      validate: (input: string) => {
        if (!input.trim()) return 'Project name is required';
        if (/[^a-zA-Z0-9._-]/.test(input)) return 'Invalid characters in project name';
        return true;
      },
    });
  }

  if (!flags.provider) {
    questions.push({
      type: 'list',
      name: 'provider',
      message: 'AI provider:',
      choices: [
        { name: 'OpenAI (gpt-4o-mini)', value: 'openai' },
        { name: 'Claude (claude-sonnet)', value: 'claude' },
        { name: 'Groq (llama-3.3-70b)', value: 'groq' },
      ],
    });
  }

  if (!flags.ts && !flags.js) {
    questions.push({
      type: 'confirm',
      name: 'typescript',
      message: 'Use TypeScript?',
      default: true,
    });
  }

  if (!flags.template) {
    questions.push({
      type: 'list',
      name: 'template',
      message: 'Template:',
      choices: [
        { name: 'Basic — minimal single agent', value: 'basic' },
        { name: 'Multi-agent — team of agents', value: 'multi-agent' },
        { name: 'Server — with admin panel', value: 'server' },
      ],
    });
  }

  questions.push({
    type: 'confirm',
    name: 'includeExamples',
    message: 'Include examples?',
    default: true,
  });

  const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};

  return {
    name: projectNameArg || answers.name,
    provider: (flags.provider as string) || answers.provider || 'openai',
    typescript: flags.ts ? true : flags.js ? false : answers.typescript ?? true,
    template: (flags.template as string) || answers.template || 'basic',
    includeExamples: answers.includeExamples ?? true,
  };
}

// ── Project Creation ────────────────────────────────────────────────────────

async function createProject(options: ProjectOptions, runInstall: boolean): Promise<void> {
  const targetDir = path.resolve(process.cwd(), options.name);

  if (fs.existsSync(targetDir)) {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: `Directory ${chalk.cyan(options.name)} already exists. Continue?`,
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.yellow('Cancelled.'));
      process.exit(0);
    }
  }

  console.log();
  console.log(`Creating project in ${chalk.cyan(targetDir)}...`);
  console.log();

  fs.mkdirSync(targetDir, { recursive: true });

  const context: TemplateContext = {
    projectName: options.name,
    provider: options.provider,
    typescript: options.typescript,
    providerEnvKey: PROVIDER_ENV_KEYS[options.provider],
    defaultModel: PROVIDER_MODELS[options.provider],
  };

  const templatesDir = path.resolve(__dirname, '..', 'templates');

  // Copy base files
  copyBaseFiles(templatesDir, targetDir, context, options);

  // Process template files
  processTemplate(templatesDir, targetDir, context, options);

  // Write .env
  writeEnvFile(targetDir, options);

  if (runInstall) {
    await installDependencies(targetDir);
  }

  printNextSteps(options, runInstall);
}

// ── File Helpers ────────────────────────────────────────────────────────────

function copyBaseFiles(
  templatesDir: string,
  targetDir: string,
  context: TemplateContext,
  options: ProjectOptions,
): void {
  const baseDir = path.join(templatesDir, 'base');

  // .gitignore
  const gitignoreSrc = path.join(baseDir, '_gitignore');
  if (fs.existsSync(gitignoreSrc)) {
    fs.copyFileSync(gitignoreSrc, path.join(targetDir, '.gitignore'));
    console.log(chalk.green('  ✓'), 'Created .gitignore');
  }

  // tsconfig.json (only for TypeScript projects)
  if (options.typescript) {
    const tsconfigSrc = path.join(baseDir, 'tsconfig.json');
    if (fs.existsSync(tsconfigSrc)) {
      fs.copyFileSync(tsconfigSrc, path.join(targetDir, 'tsconfig.json'));
      console.log(chalk.green('  ✓'), 'Created tsconfig.json');
    }
  }
}

function processTemplate(
  templatesDir: string,
  targetDir: string,
  context: TemplateContext,
  options: ProjectOptions,
): void {
  const templateDir = path.join(templatesDir, options.template);

  // package.json.hbs
  const pkgTemplate = fs.readFileSync(path.join(templateDir, 'package.json.hbs'), 'utf-8');
  const pkgContent = Handlebars.compile(pkgTemplate)(context);
  fs.writeFileSync(path.join(targetDir, 'package.json'), pkgContent);
  console.log(chalk.green('  ✓'), 'Created package.json');

  // Source file
  const ext = options.typescript ? 'ts' : 'js';
  const srcDir = path.join(targetDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  const srcTemplatePath = path.join(templateDir, 'src', `index.${ext}.hbs`);
  const srcTemplate = fs.readFileSync(srcTemplatePath, 'utf-8');
  const srcContent = Handlebars.compile(srcTemplate)(context);
  fs.writeFileSync(path.join(srcDir, `index.${ext}`), srcContent);
  console.log(chalk.green('  ✓'), `Created src/index.${ext}`);

  // README
  const readmeTemplatePath = path.join(templateDir, 'README.md.hbs');
  if (fs.existsSync(readmeTemplatePath)) {
    const readmeTemplate = fs.readFileSync(readmeTemplatePath, 'utf-8');
    const readmeContent = Handlebars.compile(readmeTemplate)(context);
    fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);
    console.log(chalk.green('  ✓'), 'Created README.md');
  }
}

function writeEnvFile(targetDir: string, options: ProjectOptions): void {
  const lines: string[] = [
    '# AI Provider',
    `AI_PROVIDER=${options.provider}`,
    `${PROVIDER_ENV_KEYS[options.provider]}=your-api-key-here`,
    '',
    '# X (Twitter) Authentication',
    'X_AUTH_TOKEN=your-x-auth-token',
    '',
    '# TTS (Text-to-Speech)',
    'TTS_PROVIDER=openai',
    '# ELEVENLABS_API_KEY=your-elevenlabs-key',
    '',
    '# Optional',
    '# HEADLESS=true',
    '# PORT=3000',
  ];

  fs.writeFileSync(path.join(targetDir, '.env'), lines.join('\n') + '\n');
  console.log(chalk.green('  ✓'), 'Created .env');
}

async function installDependencies(targetDir: string): Promise<void> {
  const spinner = ora('Installing dependencies...').start();

  try {
    await new Promise<void>((resolve, reject) => {
      const child = childProcess.spawn('npm', ['install'], {
        cwd: targetDir,
        stdio: 'pipe',
      });

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install exited with code ${code}`));
      });

      child.on('error', reject);
    });

    spinner.succeed('Installed dependencies');
  } catch {
    spinner.warn('Could not install dependencies. Run npm install manually.');
  }
}

function printNextSteps(options: ProjectOptions, installed: boolean): void {
  console.log();
  console.log(chalk.bold('Done! Next steps:'));
  console.log();
  console.log(`  ${chalk.cyan('cd')} ${options.name}`);
  if (!installed) {
    console.log(`  ${chalk.cyan('npm install')}`);
  }
  console.log(`  ${chalk.gray('#')} Fill in your API keys in .env`);
  console.log(`  ${chalk.cyan('npm start')}`);
  console.log();
}


