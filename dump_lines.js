const fs = require('fs');
const content = fs.readFileSync('chat/src/App.svelte', 'utf-8');
const lines = content.split('\n');
const slice = lines.slice(2199, 2500).join('\n');
fs.writeFileSync('output.txt', slice, 'utf-8');
console.log('Done');