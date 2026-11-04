#!/usr/bin/env node
// Generate the Ed25519 key pair for Web Bot Auth. Prints the private key
// (PKCS8 PEM, for WEB_BOT_AUTH_PRIVATE_KEY) to stdout and the public JWK to
// stderr. Store the private key in Secret Manager; never commit it.
import { generateKeyPairSync } from 'node:crypto';
import { directoryBody } from '../api/_lib/web-bot-auth.js';

const { privateKey } = generateKeyPairSync('ed25519');
process.stdout.write(privateKey.export({ format: 'pem', type: 'pkcs8' }));
process.stderr.write(`${JSON.stringify(directoryBody(privateKey), null, 2)}\n`);
