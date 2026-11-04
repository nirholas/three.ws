#!/usr/bin/env node
// three-ws-agent entry point. The version check runs before any import that
// needs a newer Node (node:sqlite), so an old Node gets a fix, not a stack trace.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
	process.stderr.write(
		`three-ws-agent needs Node.js 22.13 or newer (it stores sessions with the built-in node:sqlite); this is Node ${process.versions.node}.\n` +
			'Install a current release from https://nodejs.org, or with a version manager: nvm install 22 && nvm use 22\n',
	);
	process.exit(1);
}

const { main } = await import('../src/cli.js');
process.exitCode = await main(process.argv.slice(2));
