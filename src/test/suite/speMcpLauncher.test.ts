import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../../../');

interface SpeMcpLauncher {
  SPE_MCP_ARGS: string[];
  SPE_MCP_PACKAGE: string;
  resolveClient(env: Record<string, string | undefined>): string;
  resolveStateDir(client: string, homeDir: string): string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const launcher = require(path.join(repoRoot, 'scripts', 'spe-mcp.cjs')) as SpeMcpLauncher;

function readRepoFile(fileName: string): string {
  return fs.readFileSync(path.join(repoRoot, fileName), 'utf8');
}

suite('SPE MCP launcher', () => {
  test('selects Claude Code when CLAUDE_PROJECT_DIR is set and Copilot CLI otherwise', () => {
    assert.equal(launcher.resolveClient({ CLAUDE_PROJECT_DIR: '/work/project', PATH: '/usr/bin' }), 'claude-code');
    assert.equal(launcher.resolveClient({ PATH: '/usr/bin' }), 'copilot-cli');
  });

  test('gives each client an absolute state directory under the home directory', () => {
    const home = path.resolve('/home/developer');
    const claude = launcher.resolveStateDir('claude-code', home);
    const copilot = launcher.resolveStateDir('copilot-cli', home);

    assert.equal(claude, path.join(home, '.spe-mcp', 'contextrelay-claude-code'));
    assert.equal(copilot, path.join(home, '.spe-mcp', 'contextrelay-copilot-cli'));
    assert.ok(path.isAbsolute(claude));
    assert.notEqual(claude, copilot);
  });

  test('.mcp.json starts the launcher instead of a shared state directory', () => {
    const config = JSON.parse(readRepoFile('.mcp.json')) as {
      mcpServers: { spe: { command: string; args: string[]; env?: Record<string, string> } };
    };

    assert.equal(config.mcpServers.spe.command, 'node');
    assert.deepEqual(config.mcpServers.spe.args, ['scripts/spe-mcp.cjs']);
    assert.equal(config.mcpServers.spe.env?.SPE_DATA_DIR, undefined);
  });

  test('keeps the launcher on the same pinned read-only server as the other client configurations', () => {
    const vscodeConfig = JSON.parse(readRepoFile('.vscode/mcp.json')) as { servers: { spe: { args: string[] } } };
    const codexConfig = readRepoFile('.codex/config.toml');

    assert.deepEqual(vscodeConfig.servers.spe.args, ['--yes', launcher.SPE_MCP_PACKAGE, ...launcher.SPE_MCP_ARGS]);
    assert.ok(codexConfig.includes(`"${launcher.SPE_MCP_PACKAGE}"`));
    assert.deepEqual(launcher.SPE_MCP_ARGS, ['start', '--read-only', '--tools', 'readOnly']);
  });
});
