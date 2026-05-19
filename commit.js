import { execSync } from 'child_process';
try {
  execSync('git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com" && git add . && git commit -m "feat(pump): add USDC quote support and V2 instruction routing" && git push origin HEAD && git push threews HEAD');
} catch (e) {}