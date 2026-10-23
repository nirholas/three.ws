#!/usr/bin/env node
// Launcher: `npx three-ws <command>` runs the exact same CLI as `npx @three-ws/cli <command>`.
import { main } from '@three-ws/cli';

process.exitCode = await main();
