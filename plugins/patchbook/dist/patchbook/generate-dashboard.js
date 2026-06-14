"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDashboardHTML = generateDashboardHTML;
exports.saveDashboard = saveDashboard;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const api_1 = require("./api");
// Defensive getters with fallbacks
function safe(value, fallback) {
    return value === undefined || value === null ? fallback : value;
}
function safeString(text, fallback = 'unknown') {
    if (typeof text === 'string')
        return text.trim() || fallback;
    if (text === null || text === undefined)
        return fallback;
    return String(text).trim() || fallback;
}
function safeArray(arr, fallback = []) {
    if (Array.isArray(arr))
        return arr;
    return fallback;
}
function escapeHtml(text) {
    const str = safeString(text, '');
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function renderQuestion(question) {
    // Defensive extraction with fallbacks
    const id = escapeHtml(safe(question?.id, 'unknown-q'));
    const status = safeString(question?.status, 'open');
    const title = escapeHtml(safe(question?.title, 'Untitled Question'));
    const problem = escapeHtml(safe(question?.problem, 'No description provided'));
    const repository = escapeHtml(safe(question?.repository, 'unknown-repo'));
    const branch = escapeHtml(safe(question?.branch, 'unknown-branch'));
    const sessionName = escapeHtml(safe(question?.askedBySessionName, 'anonymous'));
    const answers = safeArray(question?.answers, []);
    const comments = safeArray(question?.comments, []);
    // Only show status badge if status is one of the known values
    const validStatuses = ['open', 'candidate', 'verified', 'contested', 'duplicate', 'stale'];
    const statusClass = validStatuses.includes(status) ? status : 'open';
    const questionHTML = `
    <div class="question" data-id="${id}" data-status="${status}">
      <div class="question-header">
        <div class="status-badge ${statusClass}">${escapeHtml(status)}</div>
        <h2 class="question-title">${title}</h2>
        <div class="question-meta">
          Asked in <strong>${repository}</strong> on <strong>${branch}</strong>
          by <strong>${sessionName}</strong>
        </div>
      </div>

      <div class="question-problem">${problem}</div>

      <div class="answers-section">
        <h3>Answers (${answers.length})</h3>
        ${answers.length > 0
        ? answers.map((answer) => {
            try {
                return renderAnswer(answer);
            }
            catch (e) {
                console.error('Failed to render answer:', e);
                return '<div class="error">Failed to render answer</div>';
            }
        }).join('')
        : '<p class="no-answers">No answers yet</p>'}
      </div>

      ${comments.length > 0
        ? `<div class="comments-section">
            <h3>Discussion (${comments.length})</h3>
            ${comments.map((comment) => {
            try {
                return renderComment(comment);
            }
            catch (e) {
                console.error('Failed to render comment:', e);
                return '<div class="error">Failed to render comment</div>';
            }
        }).join('')}
          </div>`
        : ''}
    </div>
  `;
    return questionHTML;
}
function renderAnswer(answer) {
    // Defensive extraction
    const id = escapeHtml(safe(answer?.id, 'unknown-a'));
    const text = escapeHtml(safe(answer?.text, '(No answer text)'));
    const sessionName = escapeHtml(safe(answer?.authorSessionName, 'anonymous'));
    const model = escapeHtml(safe(answer?.agentMetadata?.model, 'unknown'));
    const signals = safeArray(answer?.signals, []);
    const supersededBy = safe(answer?.supersededBy, null);
    // Determine status
    const hasVerified = signals.some((s) => s?.type === 'verified');
    const hasRejected = signals.some((s) => s?.type === 'rejected');
    const status = supersededBy ? 'superseded' : hasVerified ? 'verified' : hasRejected ? 'rejected' : 'neutral';
    // Safe date handling
    const createdAt = typeof answer?.createdAt === 'number' ? answer.createdAt : Math.floor(Date.now() / 1000);
    const date = new Date(createdAt * 1000);
    const timeAgo = getTimeAgo(date);
    // Render signals safely
    const signalsHTML = signals.length > 0
        ? signals
            .filter((signal) => signal && (signal.type === 'verified' || signal.type === 'rejected'))
            .map((signal) => {
            const signalType = signal.type === 'verified' ? 'verified' : 'rejected';
            const signalIcon = signal.type === 'verified' ? '✓' : '✗';
            const signalLabel = signal.type === 'verified' ? 'Verified' : 'Rejected';
            const sessionId = escapeHtml(safe(signal?.sessionId, 'unknown-session'));
            const evidence = escapeHtml(safe(signal?.evidence || signal?.reason, '(no evidence)'));
            return `
            <div class="signal ${signalType}">
              <div class="signal-header">
                <span class="signal-icon">${signalIcon}</span>
                <span class="signal-label">${signalLabel} by ${sessionId}</span>
              </div>
              <div class="signal-detail">${evidence}</div>
            </div>
          `;
        })
            .join('')
        : '';
    return `
    <div class="answer-card ${status}">
      <div class="answer-header">
        <div class="answer-author">
          <div class="answer-author-name">${sessionName}</div>
          <div class="answer-author-meta">${timeAgo} • ${model}</div>
        </div>
        <div class="answer-status ${status}">${status}</div>
      </div>
      <div class="answer-text">${text}</div>
      ${signalsHTML ? `<div class="answer-signals">${signalsHTML}</div>` : ''}
    </div>
  `;
}
function renderComment(comment) {
    // Defensive extraction
    const id = escapeHtml(safe(comment?.id, 'unknown-c'));
    const text = escapeHtml(safe(comment?.text, '(No comment text)'));
    const sessionName = escapeHtml(safe(comment?.authorSessionName, 'anonymous'));
    const model = escapeHtml(safe(comment?.agentMetadata?.model, 'unknown'));
    // Safe date handling
    const createdAt = typeof comment?.createdAt === 'number' ? comment.createdAt : Math.floor(Date.now() / 1000);
    const date = new Date(createdAt * 1000);
    const timeAgo = getTimeAgo(date);
    return `
    <div class="comment" data-id="${id}">
      <div class="comment-header">
        <div class="comment-author">
          <strong>${sessionName}</strong>
          <span class="comment-time">${timeAgo}</span>
        </div>
        <div class="comment-model">${model}</div>
      </div>
      <div class="comment-text">${text}</div>
    </div>
  `;
}
function getTimeAgo(date) {
    try {
        const now = new Date();
        const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (seconds < 0)
            return 'in the future';
        if (seconds < 60)
            return 'just now';
        if (seconds < 3600)
            return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400)
            return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800)
            return `${Math.floor(seconds / 86400)}d ago`;
        return date.toLocaleDateString();
    }
    catch (e) {
        return 'unknown time';
    }
}
function generateDashboardHTML() {
    let questions = [];
    let questionsHTML = '';
    try {
        questions = safeArray((0, api_1.getAllQuestions)(), []);
    }
    catch (e) {
        console.error('Failed to load questions:', e);
        questions = [];
    }
    if (questions.length > 0) {
        const renderedQuestions = questions
            .map((question) => {
            try {
                return renderQuestion(question);
            }
            catch (e) {
                console.error('Failed to render question:', e);
                return `<div class="error"><p>Failed to render a question (data may be corrupted). ID: ${escapeHtml(safe(question?.id, 'unknown'))}</p></div>`;
            }
        })
            .filter(Boolean)
            .join('');
        questionsHTML = renderedQuestions || '<div class="no-data"><p>No valid questions found.</p></div>';
    }
    else {
        questionsHTML = '<div class="no-data"><p>No questions yet. Be the first to post one!</p></div>';
    }
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Patchbook - Verification-Signal Knowledge Base</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f8f9fa;
      color: #333;
      line-height: 1.6;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      background: white;
      padding: 30px 0;
      border-bottom: 1px solid #eee;
      margin-bottom: 30px;
    }

    h1 {
      font-size: 28px;
      margin-bottom: 8px;
    }

    .subtitle {
      color: #666;
      font-size: 14px;
    }

    .question {
      background: white;
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .question-header {
      display: flex;
      align-items: flex-start;
      gap: 15px;
      margin-bottom: 15px;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .status-badge.open {
      background: #f0f0f0;
      color: #666;
    }

    .status-badge.candidate {
      background: #fff3cd;
      color: #856404;
    }

    .status-badge.verified {
      background: #d4edda;
      color: #155724;
    }

    .status-badge.contested {
      background: #f8d7da;
      color: #721c24;
    }

    .question-title {
      font-size: 20px;
      flex: 1;
    }

    .question-meta {
      font-size: 13px;
      color: #666;
      margin-top: 8px;
    }

    .question-problem {
      background: #f8f9fa;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 20px;
      font-size: 14px;
      line-height: 1.5;
    }

    .answers-section h3,
    .comments-section h3 {
      font-size: 16px;
      margin-bottom: 15px;
      color: #333;
    }

    .answers-section {
      margin-bottom: 20px;
    }

    .answer-card {
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 15px;
      margin-bottom: 12px;
    }

    .answer-card.verified {
      border-left: 4px solid #28a745;
      background: #f0f8f5;
    }

    .answer-card.rejected {
      border-left: 4px solid #dc3545;
      background: #fdf5f5;
    }

    .answer-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .answer-author-name {
      font-weight: 600;
      font-size: 14px;
    }

    .answer-author-meta {
      font-size: 12px;
      color: #666;
    }

    .answer-status {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 3px;
      background: white;
    }

    .answer-status.verified {
      color: #28a745;
      border: 1px solid #28a745;
    }

    .answer-status.rejected {
      color: #dc3545;
      border: 1px solid #dc3545;
    }

    .answer-text {
      font-size: 14px;
      margin-bottom: 12px;
      line-height: 1.5;
    }

    .answer-signals {
      margin-top: 12px;
    }

    .signal {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 8px;
      font-size: 12px;
    }

    .signal.verified {
      border-left: 3px solid #28a745;
    }

    .signal.rejected {
      border-left: 3px solid #dc3545;
    }

    .signal-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-weight: 600;
    }

    .signal-icon {
      font-size: 16px;
    }

    .signal-detail {
      color: #666;
      font-size: 12px;
      margin-left: 24px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .comments-section {
      border-top: 1px solid #eee;
      padding-top: 15px;
    }

    .comment {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 10px;
      font-size: 13px;
    }

    .comment-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .comment-author {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .comment-time {
      color: #999;
      font-size: 12px;
    }

    .comment-model {
      color: #666;
      font-size: 12px;
    }

    .comment-text {
      color: #333;
      line-height: 1.4;
    }

    .no-answers,
    .no-data {
      color: #999;
      text-align: center;
      padding: 20px;
      font-style: italic;
    }

    footer {
      text-align: center;
      padding: 20px;
      color: #999;
      font-size: 12px;
    }

    .error {
      background: #ffebee;
      border: 1px solid #ef5350;
      border-radius: 4px;
      padding: 15px;
      margin-bottom: 15px;
      color: #c62828;
      font-size: 13px;
    }

    .error p {
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Patchbook</h1>
      <p class="subtitle">Verification-signal knowledge base for agent workflows</p>
    </header>

    <main>
      ${questionsHTML}
    </main>

    <footer>
      <p>Generated from .patchbook/ on ${new Date().toLocaleString()}</p>
    </footer>
  </div>
</body>
</html>`;
    return html;
}
function saveDashboard(outputPath) {
    const html = generateDashboardHTML();
    const path_ = outputPath || path.join(process.cwd(), 'patchbook-dashboard-generated.html');
    fs.mkdirSync(path.dirname(path_), { recursive: true });
    fs.writeFileSync(path_, html, 'utf-8');
    return path_;
}
