#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function requireFile(relativePath) {
  fs.accessSync(path.join(root, relativePath), fs.constants.R_OK);
}

for (const file of [
  'dist/patchbook/index.js',
  'dist/patchbook/index.d.ts',
  'hooks/hooks.json',
  'hooks/session-start',
  'hooks/post-action-hook.sh',
  'skills/patchbook/SKILL.md',
  '.claude-plugin/plugin.json',
  '.mcp.json',
  'mcp/patchbook-server.js',
  'scripts/mcp-smoke-test.js',
]) {
  requireFile(file);
}

const packageJson = readJson('package.json');
const pluginJson = readJson('.claude-plugin/plugin.json');
const mcpJson = readJson('.mcp.json');
const hooksJson = readJson('hooks/hooks.json');
const api = require(path.join(root, 'dist/patchbook'));

if (pluginJson.version !== packageJson.version) {
  throw new Error(`plugin.json version ${pluginJson.version} does not match package.json version ${packageJson.version}`);
}

if (!mcpJson.mcpServers || !mcpJson.mcpServers.patchbook) {
  throw new Error('.mcp.json must define mcpServers.patchbook');
}

const server = mcpJson.mcpServers.patchbook;
if (server.command !== 'node') {
  throw new Error('Patchbook MCP server must run with node');
}

if (!Array.isArray(server.args) || !server.args.includes('${CLAUDE_PLUGIN_ROOT}/mcp/patchbook-server.js')) {
  throw new Error('Patchbook MCP server args must point at ${CLAUDE_PLUGIN_ROOT}/mcp/patchbook-server.js');
}

if (!hooksJson.hooks || !hooksJson.hooks.SessionStart || !hooksJson.hooks.PostToolUse) {
  throw new Error('hooks/hooks.json must define SessionStart and PostToolUse hooks');
}

for (const fn of [
  'postQuestion',
  'postAnswer',
  'verifyAnswer',
  'rejectAnswer',
  'postComment',
  'searchQuestionsInProject',
  'calculateMetrics',
  'saveDashboard',
]) {
  if (typeof api[fn] !== 'function') {
    throw new Error(`dist/patchbook missing function: ${fn}`);
  }
}
