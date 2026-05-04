#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';

const AGENTS_DIR = path.resolve(process.cwd(), 'src', 'agents');
const DIST_DIR = path.resolve(process.cwd(), 'dist');

async function getAgentConfig(agentName) {
  const agentConfigFile = path.join(AGENTS_DIR, `${agentName}.js`);
  try {
    const config = await import(agentConfigFile);
    return config.default;
  } catch (error) {
    console.error(`Error: Could not load agent configuration for "${agentName}".`);
    console.error(`Make sure "src/agents/${agentName}.js" exists and is a valid module.`);
    throw error;
  }
}

async function packageAgent(agentName, agentConfig) {
  await fs.mkdir(DIST_DIR, { recursive: true });
  const zipPath = path.join(DIST_DIR, `${agentName}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`✅ Agent package created at: ${zipPath}`);
      console.log(`Total size: ${archive.pointer()} bytes`);
      resolve(zipPath);
    });
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // Add agent config
    archive.file(path.join(AGENTS_DIR, `${agentName}.js`), { name: 'agent.js' });

    // Add 3D model
    if (agentConfig.model) {
      const modelPath = path.resolve(process.cwd(), 'public', agentConfig.model);
      archive.file(modelPath, { name: path.basename(agentConfig.model) });
    }

    // Add other assets if specified
    // (This can be extended to include skills, etc.)

    archive.finalize();
  });
}

async function main() {
  const agentName = process.argv[2];
  if (!agentName) {
    console.error('Error: Please provide an agent name.');
    console.log('Usage: node scripts/deploy-agent.mjs <agent_name>');
    process.exit(1);
  }

  console.log(`📦 Starting deployment process for agent: "${agentName}"...`);

  const agentConfig = await getAgentConfig(agentName);
  await packageAgent(agentName, agentConfig);

  console.log(`🚀 Deployment package for "${agentName}" is ready!`);
}

main().catch(err => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
