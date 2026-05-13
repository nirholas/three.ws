// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import inquirer from 'inquirer';

export interface InitAnswers {
  provider: string;
  apiKey: string;
  systemPrompt: string;
  ttsProvider: string;
  ttsApiKey?: string;
  authMethod: string;
  authToken?: string;
}

export async function promptInit(): Promise<InitAnswers> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'AI Provider:',
      choices: [
        { name: 'OpenAI (gpt-4o-mini)', value: 'openai' },
        { name: 'OpenAI Chat (gpt-4o-mini)', value: 'openai-chat' },
        { name: 'Claude (claude-sonnet)', value: 'claude' },
        { name: 'Groq (llama-3.3-70b)', value: 'groq' },
      ],
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      mask: '*',
      validate: (input: string) => input.length > 0 || 'API key is required',
    },
    {
      type: 'input',
      name: 'systemPrompt',
      message: 'System prompt:',
      default: 'You are a helpful AI agent participating in an X Space.',
    },
    {
      type: 'list',
      name: 'ttsProvider',
      message: 'TTS Provider:',
      choices: [
        { name: 'OpenAI TTS (built-in, no extra key)', value: 'openai' },
        { name: 'ElevenLabs (premium voices)', value: 'elevenlabs' },
      ],
    },
    {
      type: 'password',
      name: 'ttsApiKey',
      message: 'ElevenLabs API Key:',
      mask: '*',
      when: (ans: InitAnswers) => ans.ttsProvider === 'elevenlabs',
      validate: (input: string) => input.length > 0 || 'ElevenLabs API key is required',
    },
  ]);

  return answers;
}

export async function promptAuth(): Promise<{ method: string; authToken?: string; username?: string; password?: string }> {
  const { method } = await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'Login method:',
      choices: [
        { name: 'Paste auth_token (easiest)', value: 'token' },
        { name: 'Login with username/password', value: 'credentials' },
      ],
    },
  ]);

  if (method === 'token') {
    const { authToken } = await inquirer.prompt([
      {
        type: 'password',
        name: 'authToken',
        message: 'auth_token:',
        mask: '*',
        validate: (input: string) => input.length > 0 || 'auth_token is required',
      },
    ]);
    return { method, authToken };
  }

  const credentials = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: 'X Username:',
      validate: (input: string) => input.length > 0 || 'Username is required',
    },
    {
      type: 'password',
      name: 'password',
      message: 'X Password:',
      mask: '*',
      validate: (input: string) => input.length > 0 || 'Password is required',
    },
  ]);

  return { method, ...credentials };
}


