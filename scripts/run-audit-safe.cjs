const { spawnSync } = require('node:child_process');

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('npm_execpath is not set. Unable to execute npm audit.');
  process.exit(1);
}

const env = { ...process.env };
delete env.npm_config_allow_scripts;

const result = spawnSync(process.execPath, [npmCli, 'audit', '--audit-level=moderate'], {
  env,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
