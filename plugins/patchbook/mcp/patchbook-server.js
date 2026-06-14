#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const patchbook = require('../dist/patchbook');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_VERSION = '0.2.0';

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PWD || process.cwd();
}

if (!process.env.PATCHBOOK_ROOT) {
  process.env.PATCHBOOK_ROOT = path.join(projectRoot(), '.patchbook');
}

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function inferRepository() {
  if (process.env.PATCHBOOK_REPOSITORY) return process.env.PATCHBOOK_REPOSITORY;

  const remote = runGit(['config', '--get', 'remote.origin.url']);
  if (remote) {
    return remote
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/\.git$/, '');
  }

  return path.basename(projectRoot()) || 'unknown-repository';
}

function inferBranch() {
  return (
    process.env.PATCHBOOK_BRANCH ||
    process.env.GIT_BRANCH ||
    process.env.BRANCH ||
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']) ||
    'main'
  );
}

function inferAuthor() {
  return (
    process.env.PATCHBOOK_AUTHOR ||
    process.env.GIT_AUTHOR_EMAIL ||
    runGit(['config', '--get', 'user.email']) ||
    process.env.USER ||
    'claude-agent'
  );
}

function inferSessionName() {
  return (
    process.env.PATCHBOOK_SESSION_NAME ||
    process.env.CLAUDE_SESSION_ID ||
    `claude-session-${new Date().toISOString().slice(0, 10)}`
  );
}

function inferSessionId(prefix) {
  const base =
    process.env.PATCHBOOK_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    inferSessionName();
  return `${prefix}/${base}`;
}

function agentMetadata() {
  const metadata = patchbook.captureAgentMetadata();
  return {
    ...metadata,
    branch: metadata.branch || inferBranch(),
    commitSha: metadata.commitSha || runGit(['rev-parse', 'HEAD']) || undefined,
  };
}

function requireString(args, field) {
  const value = args && typeof args[field] === 'string' ? args[field].trim() : '';
  if (!value) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(args, field, fallback) {
  const value = args && typeof args[field] === 'string' ? args[field].trim() : '';
  return value || fallback;
}

function optionalLimit(args, fallback = 20) {
  const raw = args && typeof args.limit === 'number' ? args.limit : fallback;
  return Math.max(1, Math.min(100, Math.floor(raw)));
}

function compactSignal(signal) {
  if (!signal) return signal;
  return {
    type: signal.type,
    sessionId: signal.sessionId,
    evidence: signal.evidence,
    reason: signal.reason,
    createdAt: signal.createdAt,
  };
}

function compactAnswer(answer) {
  return {
    id: answer.id,
    text: answer.text,
    author: answer.author,
    authorSessionName: answer.authorSessionName,
    createdAt: answer.createdAt,
    verifiedCount: answer.signals.filter((signal) => signal.type === 'verified').length,
    rejectedCount: answer.signals.filter((signal) => signal.type === 'rejected').length,
    signals: answer.signals.map(compactSignal),
  };
}

function compactQuestion(question) {
  return {
    id: question.id,
    title: question.title,
    problem: question.problem,
    repository: question.repository,
    branch: question.branch,
    keywords: question.keywords,
    status: question.status,
    version: question.version,
    askedBy: question.askedBy,
    askedBySessionName: question.askedBySessionName,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    answerCount: question.answers.length,
    commentCount: question.comments.length,
    answers: question.answers.map(compactAnswer),
    comments: question.comments,
  };
}

function loadQuestionOrThrow(questionId) {
  const question = patchbook.getQuestion(questionId);
  if (!question) {
    throw new Error(`Question ${questionId} not found`);
  }
  return question;
}

function textResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const tools = [
  {
    name: 'search',
    description: 'Search project-local Patchbook questions and verified answers before debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query describing the bug, error, or pattern.' },
        limit: { type: 'number', description: 'Maximum results to return. Defaults to 20, max 100.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_question',
    description: 'Post a new Patchbook question when no existing solution was found.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short searchable title.' },
        problem: { type: 'string', description: 'Full problem context, reproduction steps, error output, and attempted fixes.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Optional searchable tags.' },
        repository: { type: 'string', description: 'Repository name or URL. Inferred from git remote when omitted.' },
        branch: { type: 'string', description: 'Git branch. Inferred from git when omitted.' },
        author: { type: 'string', description: 'Agent/user identifier. Inferred when omitted.' },
        authorSessionName: { type: 'string', description: 'Human-readable session name. Inferred when omitted.' },
      },
      required: ['title', 'problem'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_answer',
    description: 'Post a candidate answer or solution for an existing Patchbook question.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Question ID such as q_abc123.' },
        text: { type: 'string', description: 'Specific solution, commands, code changes, and caveats.' },
        author: { type: 'string', description: 'Agent/user identifier. Inferred when omitted.' },
        authorSessionName: { type: 'string', description: 'Human-readable session name. Inferred when omitted.' },
      },
      required: ['questionId', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'verify_answer',
    description: 'Mark an answer verified with concrete testing evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Question ID.' },
        answerId: { type: 'string', description: 'Answer ID.' },
        evidence: { type: 'string', description: 'Specific evidence: tests run, environment, result, reproduction status.' },
        sessionId: { type: 'string', description: 'Unique verification session ID. Inferred when omitted.' },
      },
      required: ['questionId', 'answerId', 'evidence'],
      additionalProperties: false,
    },
  },
  {
    name: 'reject_answer',
    description: 'Reject an answer that failed in this context, with a concrete reason.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Question ID.' },
        answerId: { type: 'string', description: 'Answer ID.' },
        reason: { type: 'string', description: 'Specific failure reason and context.' },
        sessionId: { type: 'string', description: 'Unique rejection session ID. Inferred when omitted.' },
      },
      required: ['questionId', 'answerId', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'comment',
    description: 'Add context to a question without verifying or rejecting an answer.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Question ID.' },
        text: { type: 'string', description: 'Context, caveat, related observation, or note.' },
        author: { type: 'string', description: 'Agent/user identifier. Inferred when omitted.' },
        authorSessionName: { type: 'string', description: 'Human-readable session name. Inferred when omitted.' },
      },
      required: ['questionId', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_question',
    description: 'Load a full Patchbook question by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Question ID.' },
      },
      required: ['questionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_questions',
    description: 'List Patchbook questions, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'candidate', 'verified', 'contested'], description: 'Optional status filter.' },
        limit: { type: 'number', description: 'Maximum questions to return. Defaults to 20, max 100.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'metrics',
    description: 'Return Patchbook analytics and verification metrics for the current project.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'generate_dashboard',
    description: 'Generate the Patchbook HTML dashboard for the current project.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'Optional output path. Defaults to .patchbook/dashboard.html.' },
      },
      additionalProperties: false,
    },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case 'search': {
      const query = requireString(args, 'query');
      const limit = optionalLimit(args);
      const results = patchbook.searchQuestionsInProject(query).slice(0, limit);
      return {
        query,
        results: results.map((result) => ({
          relevance: result.relevance,
          matchedKeywords: result.matchedKeywords,
          question: compactQuestion(result.question),
        })),
      };
    }

    case 'post_question': {
      const question = patchbook.postQuestion(
        {
          title: requireString(args, 'title'),
          problem: requireString(args, 'problem'),
          keywords: Array.isArray(args.keywords) ? args.keywords.filter((value) => typeof value === 'string') : [],
          repository: optionalString(args, 'repository', inferRepository()),
          branch: optionalString(args, 'branch', inferBranch()),
          author: optionalString(args, 'author', inferAuthor()),
          authorSessionName: optionalString(args, 'authorSessionName', inferSessionName()),
        },
        agentMetadata()
      );
      return { question: compactQuestion(question) };
    }

    case 'post_answer': {
      const question = loadQuestionOrThrow(requireString(args, 'questionId'));
      const result = patchbook.postAnswer(
        question,
        {
          text: requireString(args, 'text'),
          author: optionalString(args, 'author', inferAuthor()),
          authorSessionName: optionalString(args, 'authorSessionName', inferSessionName()),
        },
        agentMetadata()
      );
      return {
        answer: compactAnswer(result.answer),
        updatedQuestion: compactQuestion(result.updatedQuestion),
      };
    }

    case 'verify_answer': {
      const question = loadQuestionOrThrow(requireString(args, 'questionId'));
      const result = patchbook.verifyAnswer(question, {
        answerId: requireString(args, 'answerId'),
        evidence: requireString(args, 'evidence'),
        sessionId: optionalString(args, 'sessionId', inferSessionId('verify')),
      });
      return {
        signal: compactSignal(result.signal),
        updatedQuestion: compactQuestion(result.updatedQuestion),
      };
    }

    case 'reject_answer': {
      const question = loadQuestionOrThrow(requireString(args, 'questionId'));
      const result = patchbook.rejectAnswer(question, {
        answerId: requireString(args, 'answerId'),
        reason: requireString(args, 'reason'),
        sessionId: optionalString(args, 'sessionId', inferSessionId('reject')),
      });
      return {
        signal: compactSignal(result.signal),
        updatedQuestion: compactQuestion(result.updatedQuestion),
      };
    }

    case 'comment': {
      const question = loadQuestionOrThrow(requireString(args, 'questionId'));
      const result = patchbook.postComment(
        question,
        requireString(args, 'text'),
        optionalString(args, 'author', inferAuthor()),
        optionalString(args, 'authorSessionName', inferSessionName()),
        agentMetadata()
      );
      return {
        comment: result.comment,
        updatedQuestion: compactQuestion(result.updatedQuestion),
      };
    }

    case 'get_question': {
      return { question: compactQuestion(loadQuestionOrThrow(requireString(args, 'questionId'))) };
    }

    case 'list_questions': {
      const status = typeof args.status === 'string' ? args.status : '';
      const limit = optionalLimit(args);
      const questions = (status ? patchbook.getQuestionsByStatus(status) : patchbook.getAllQuestions())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map(compactQuestion);
      return { questions };
    }

    case 'metrics': {
      const questions = patchbook.getAllQuestions();
      return { metrics: patchbook.calculateMetrics(questions) };
    }

    case 'generate_dashboard': {
      const outputPath = optionalString(args, 'outputPath', path.join(process.env.PATCHBOOK_ROOT, 'dashboard.html'));
      return { outputPath: patchbook.saveDashboard(outputPath) };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') return;

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      if (!isNotification) {
        send(response(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'patchbook', version: SERVER_VERSION },
        }));
      }
      return;
    }

    if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
      return;
    }

    if (method === 'ping') {
      if (!isNotification) send(response(id, {}));
      return;
    }

    if (method === 'tools/list') {
      if (!isNotification) send(response(id, { tools }));
      return;
    }

    if (method === 'tools/call') {
      const name = requireString(params || {}, 'name');
      const result = callTool(name, params?.arguments || {});
      if (!isNotification) send(response(id, textResult(result)));
      return;
    }

    if (method === 'resources/list') {
      if (!isNotification) send(response(id, { resources: [] }));
      return;
    }

    if (method === 'prompts/list') {
      if (!isNotification) send(response(id, { prompts: [] }));
      return;
    }

    if (method === 'logging/setLevel') {
      if (!isNotification) send(response(id, {}));
      return;
    }

    if (!isNotification) {
      send(errorResponse(id, -32601, `Method not found: ${method}`));
    }
  } catch (error) {
    if (!isNotification) {
      send(errorResponse(id, -32603, error instanceof Error ? error.message : String(error)));
    }
  }
}

let buffer = '';

function processBuffer() {
  while (buffer.length > 0) {
    if (buffer.startsWith('Content-Length:')) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;

      const body = buffer.slice(bodyStart, bodyStart + length);
      buffer = buffer.slice(bodyStart + length);
      dispatchBody(body);
      continue;
    }

    const newline = buffer.indexOf('\n');
    if (newline === -1) return;

    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) dispatchBody(line);
  }
}

function dispatchBody(body) {
  try {
    const message = JSON.parse(body);
    if (Array.isArray(message)) {
      for (const item of message) handleMessage(item);
    } else {
      handleMessage(message);
    }
  } catch (error) {
    process.stderr.write(`Patchbook MCP parse error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  processBuffer();
});

process.stdin.on('end', () => {
  process.exit(0);
});
