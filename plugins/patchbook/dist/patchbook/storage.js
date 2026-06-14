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
exports.initializeStorage = initializeStorage;
exports.getQuestionPath = getQuestionPath;
exports.saveQuestion = saveQuestion;
exports.checkVersionAndSave = checkVersionAndSave;
exports.loadQuestion = loadQuestion;
exports.listAllQuestions = listAllQuestions;
exports.deleteQuestion = deleteQuestion;
exports.saveAnalyticsEvent = saveAnalyticsEvent;
exports.listAnalyticsEvents = listAnalyticsEvents;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getPatchbookRoot() {
    return process.env.PATCHBOOK_ROOT || path.join(process.cwd(), '.patchbook');
}
function getQuestionsDir() {
    return path.join(getPatchbookRoot(), 'questions');
}
function getAnalyticsDir() {
    return path.join(getPatchbookRoot(), 'analytics');
}
function getLocksDir() {
    return path.join(getPatchbookRoot(), '.locks');
}
function getLockPath(questionId) {
    return path.join(getLocksDir(), `${questionId}.lock`);
}
// File-based distributed locking using lock files on disk
function acquireLockFile(questionId, maxAttemptsMs = 5000) {
    const lockPath = getLockPath(questionId);
    const startTime = Date.now();
    // Clean up stale lock files (>10 seconds old)
    try {
        if (fs.existsSync(lockPath)) {
            const stats = fs.statSync(lockPath);
            if (Date.now() - stats.mtimeMs > 10000) {
                fs.unlinkSync(lockPath);
            }
        }
    }
    catch (error) {
        // Ignore errors during stale lock cleanup
    }
    // Try to atomically create the lock file
    while (Date.now() - startTime < maxAttemptsMs) {
        try {
            // fs.openSync with 'wx' flag fails if file already exists — atomic lock creation
            const fd = fs.openSync(lockPath, 'wx');
            try {
                fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
            }
            finally {
                fs.closeSync(fd);
            }
            return; // Lock acquired
        }
        catch (error) {
            const err = error;
            if (err.code === 'EEXIST') {
                // Lock file exists, wait and retry
                const now = Date.now();
                while (Date.now() - now < 10) {
                    // Spin-wait 10ms
                }
            }
            else {
                throw error;
            }
        }
    }
    throw new Error(`Failed to acquire lock for question ${questionId} after ${maxAttemptsMs}ms`);
}
function releaseLockFile(questionId) {
    const lockPath = getLockPath(questionId);
    try {
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
        }
    }
    catch (error) {
        // Ignore errors during lock release
    }
}
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
function initializeStorage() {
    ensureDir(getPatchbookRoot());
    ensureDir(getQuestionsDir());
    ensureDir(getAnalyticsDir());
    ensureDir(getLocksDir());
}
function getQuestionPath(questionId) {
    return path.join(getQuestionsDir(), `${questionId}.json`);
}
function saveQuestion(question) {
    initializeStorage();
    const filePath = getQuestionPath(question.id);
    // Acquire distributed file-based lock
    acquireLockFile(question.id);
    try {
        // Atomic write: write to temp file, then rename
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(question, null, 2), 'utf-8');
        fs.renameSync(tempPath, filePath);
    }
    finally {
        releaseLockFile(question.id);
    }
}
function checkVersionAndSave(question, expectedVersion) {
    initializeStorage();
    const filePath = getQuestionPath(question.id);
    // Acquire distributed file-based lock
    acquireLockFile(question.id);
    try {
        // Load current version from disk
        const currentQuestion = loadQuestion(question.id);
        if (!currentQuestion) {
            throw new Error(`Question ${question.id} not found on disk`);
        }
        // Check if version matches expected
        if (currentQuestion.version !== expectedVersion) {
            throw new Error(`Version mismatch for question ${question.id}: expected ${expectedVersion}, but found ${currentQuestion.version}. Your changes conflict with another update.`);
        }
        // Atomic write: write to temp file, then rename
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(question, null, 2), 'utf-8');
        fs.renameSync(tempPath, filePath);
    }
    finally {
        releaseLockFile(question.id);
    }
}
function loadQuestion(questionId) {
    const filePath = getQuestionPath(questionId);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    }
    catch (error) {
        console.error(`Error loading question ${questionId}:`, error);
        return null;
    }
}
function listAllQuestions() {
    initializeStorage();
    const files = fs.readdirSync(getQuestionsDir()).filter(f => f.endsWith('.json'));
    const questions = [];
    for (const file of files) {
        const questionId = file.replace('.json', '');
        const question = loadQuestion(questionId);
        if (question) {
            questions.push(question);
        }
    }
    return questions;
}
function deleteQuestion(questionId) {
    const filePath = getQuestionPath(questionId);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}
function saveAnalyticsEvent(eventId, eventData) {
    initializeStorage();
    const filePath = path.join(getAnalyticsDir(), `${eventId}.json`);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(eventData, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
}
function listAnalyticsEvents() {
    initializeStorage();
    const files = fs.readdirSync(getAnalyticsDir()).filter(f => f.endsWith('.json'));
    const events = [];
    for (const file of files) {
        try {
            const data = fs.readFileSync(path.join(getAnalyticsDir(), file), 'utf-8');
            events.push(JSON.parse(data));
        }
        catch (error) {
            console.error(`Error reading analytics event ${file}:`, error);
        }
    }
    return events;
}
