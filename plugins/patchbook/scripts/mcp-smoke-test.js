#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patchbook-mcp-'));
const projectDir = path.join(tmp, 'project');
fs.mkdirSync(projectDir, { recursive: true });

const server = spawn(process.execPath, [path.join(root, 'mcp/patchbook-server.js')], {
  cwd: projectDir,
  env: {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectDir,
    PATCHBOOK_ROOT: path.join(projectDir, '.patchbook'),
    PATCHBOOK_AUTHOR: 'mcp-smoke@example.com',
    PATCHBOOK_SESSION_NAME: 'smoke/session',
    CLAUDE_MODEL: 'smoke-model',
    CLAUDE_PROVIDER: 'smoke-provider',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let nextId = 1;
let stdout = '';
let stderr = '';
const pending = new Map();

function rejectAll(error) {
  for (const { reject, timeout } of pending.values()) {
    clearTimeout(timeout);
    reject(error);
  }
  pending.clear();
}

server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  stdout += chunk;
  let newline = stdout.indexOf('\n');
  while (newline !== -1) {
    const line = stdout.slice(0, newline).trim();
    stdout = stdout.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) {
          request.reject(new Error(message.error.message));
        } else {
          request.resolve(message.result);
        }
      }
    }
    newline = stdout.indexOf('\n');
  }
});

server.stderr.setEncoding('utf8');
server.stderr.on('data', (chunk) => {
  stderr += chunk;
});

server.on('error', rejectAll);
server.on('exit', (code) => {
  if (pending.size > 0 && code !== 0) {
    rejectAll(new Error(`MCP server exited with code ${code}: ${stderr}`));
  }
});

function send(method, params = {}) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5000);
    pending.set(id, { resolve, reject, timeout });
    server.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function parseToolResult(result) {
  assert.strictEqual(Array.isArray(result.content), true, 'tool result must include content array');
  assert.strictEqual(result.content[0].type, 'text', 'tool result must return text content');
  return JSON.parse(result.content[0].text);
}

async function main() {
  const initialized = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'patchbook-smoke-test', version: '0' },
  });
  assert.strictEqual(initialized.serverInfo.name, 'patchbook');
  assert.strictEqual(initialized.serverInfo.version, '0.2.0');

  const listed = await send('tools/list');
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  assert.deepStrictEqual(toolNames, [
    'comment',
    'generate_dashboard',
    'get_question',
    'list_questions',
    'metrics',
    'post_answer',
    'post_question',
    'reject_answer',
    'search',
    'verify_answer',
  ]);

  const postedQuestion = parseToolResult(await send('tools/call', {
    name: 'post_question',
    arguments: {
      title: 'MCP smoke search should find verified answers',
      problem: 'The MCP smoke test needs to prove the plugin can persist and retrieve project-local Patchbook data.',
      keywords: ['mcp', 'smoke'],
    },
  })).question;
  assert.match(postedQuestion.id, /^q_/);
  assert.strictEqual(postedQuestion.status, 'open');

  const postedAnswer = parseToolResult(await send('tools/call', {
    name: 'post_answer',
    arguments: {
      questionId: postedQuestion.id,
      text: 'Use the bundled Patchbook MCP server and write JSON files under the project .patchbook directory.',
    },
  })).answer;
  assert.match(postedAnswer.id, /^a_/);

  const verified = parseToolResult(await send('tools/call', {
    name: 'verify_answer',
    arguments: {
      questionId: postedQuestion.id,
      answerId: postedAnswer.id,
      sessionId: 'verify/smoke',
      evidence: 'Ran MCP smoke test through tools/list and tools/call. Question, answer, search, metrics, and dashboard paths all passed.',
    },
  })).updatedQuestion;
  assert.strictEqual(verified.status, 'verified');

  const rejectedAnswer = parseToolResult(await send('tools/call', {
    name: 'post_answer',
    arguments: {
      questionId: postedQuestion.id,
      text: 'Use global chat history instead of project-local JSON storage.',
    },
  })).answer;

  const rejected = parseToolResult(await send('tools/call', {
    name: 'reject_answer',
    arguments: {
      questionId: postedQuestion.id,
      answerId: rejectedAnswer.id,
      sessionId: 'reject/smoke',
      reason: 'Global chat history is not project-local, structured, or installable as a Claude plugin.',
    },
  })).updatedQuestion;
  assert.strictEqual(rejected.status, 'verified');

  const commented = parseToolResult(await send('tools/call', {
    name: 'comment',
    arguments: {
      questionId: postedQuestion.id,
      text: 'Smoke test comment.',
    },
  })).updatedQuestion;
  assert.strictEqual(commented.commentCount, 1);

  const search = parseToolResult(await send('tools/call', {
    name: 'search',
    arguments: { query: 'MCP smoke verified answers', limit: 5 },
  }));
  assert.strictEqual(search.results.length >= 1, true);
  assert.strictEqual(search.results[0].question.id, postedQuestion.id);

  const fullQuestion = parseToolResult(await send('tools/call', {
    name: 'get_question',
    arguments: { questionId: postedQuestion.id },
  })).question;
  assert.strictEqual(fullQuestion.answerCount, 2);
  assert.strictEqual(fullQuestion.commentCount, 1);

  const listedVerified = parseToolResult(await send('tools/call', {
    name: 'list_questions',
    arguments: { status: 'verified', limit: 5 },
  }));
  assert.strictEqual(listedVerified.questions.length, 1);

  const metrics = parseToolResult(await send('tools/call', {
    name: 'metrics',
    arguments: {},
  })).metrics;
  assert.strictEqual(metrics.totalQuestions, 1);
  assert.strictEqual(metrics.totalAnswers, 2);
  assert.strictEqual(metrics.totalComments, 1);

  const dashboard = parseToolResult(await send('tools/call', {
    name: 'generate_dashboard',
    arguments: {},
  }));
  assert.strictEqual(fs.existsSync(dashboard.outputPath), true);

  server.stdin.end();
}

main()
  .catch((error) => {
    server.kill();
    throw error;
  })
  .finally(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
