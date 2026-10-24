#!/usr/bin/env node
'use strict';

// Starts the pinned, read-only SharePoint Embedded MCP server for the clients
// that share .mcp.json (Claude Code and GitHub Copilot CLI), giving each client
// its own state directory so sign-in and tenant state never mix.

const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const SPE_MCP_PACKAGE = '@microsoft/spe-mcp@0.2.0-alpha.4';
const SPE_MCP_ARGS = ['start', '--read-only', '--tools', 'readOnly'];

/**
 * Claude Code sets CLAUDE_PROJECT_DIR for every MCP server it starts. Copilot
 * CLI passes only PATH and the variables configured in .mcp.json, so the
 * variable is absent there.
 */
function resolveClient(env) {
  return env.CLAUDE_PROJECT_DIR ? 'claude-code' : 'copilot-cli';
}

function resolveStateDir(client, homeDir) {
  return path.join(homeDir, '.spe-mcp', `contextrelay-${client}`);
}

function main() {
  const client = resolveClient(process.env);
  const stateDir = resolveStateDir(client, os.homedir());
  // stdout carries the MCP protocol, so diagnostics go to stderr.
  process.stderr.write(`spe-mcp launcher: client=${client} SPE_DATA_DIR=${stateDir}\n`);

  const child = spawn('npx', ['--yes', SPE_MCP_PACKAGE, ...SPE_MCP_ARGS], {
    env: { ...process.env, SPE_DATA_DIR: stateDir },
    stdio: 'inherit',
    // npx is a .cmd shim on Windows; the arguments are fixed, so the shell sees no user input.
    shell: process.platform === 'win32'
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', err => {
    process.stderr.write(`spe-mcp launcher: failed to start npx: ${err.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (require.main === module) {
  main();
}

module.exports = { SPE_MCP_ARGS, SPE_MCP_PACKAGE, resolveClient, resolveStateDir };
