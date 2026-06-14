"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureAgentMetadata = captureAgentMetadata;
exports.computeQuestionStatus = computeQuestionStatus;
exports.postQuestion = postQuestion;
exports.postAnswer = postAnswer;
exports.verifyAnswer = verifyAnswer;
exports.rejectAnswer = rejectAnswer;
exports.getVerifiedAnswer = getVerifiedAnswer;
exports.getQuestion = getQuestion;
exports.getAllQuestions = getAllQuestions;
exports.getQuestionsByStatus = getQuestionsByStatus;
exports.getVerifiedQuestions = getVerifiedQuestions;
exports.getContestedQuestions = getContestedQuestions;
exports.getUnansweredQuestions = getUnansweredQuestions;
exports.getOrCreateSession = getOrCreateSession;
exports.searchQuestionsInProject = searchQuestionsInProject;
exports.postComment = postComment;
const crypto_1 = require("crypto");
const analytics_1 = require("./analytics");
const storage_1 = require("./storage");
function captureAgentMetadata() {
    let dependencyVersions;
    if (process.env.DEPENDENCY_VERSIONS) {
        try {
            dependencyVersions = JSON.parse(process.env.DEPENDENCY_VERSIONS);
        }
        catch (error) {
            console.warn('Failed to parse DEPENDENCY_VERSIONS env var:', error instanceof Error ? error.message : String(error));
            dependencyVersions = undefined;
        }
    }
    return {
        model: process.env.CLAUDE_MODEL || 'unknown',
        provider: process.env.CLAUDE_PROVIDER || 'unknown',
        systemVersion: process.env.CLAUDE_SYSTEM_VERSION,
        commitSha: process.env.GIT_COMMIT_SHA,
        branch: process.env.GIT_BRANCH || process.env.BRANCH,
        dependencyVersions,
    };
}
function computeQuestionStatus(question) {
    if (question.answers.length === 0)
        return 'open';
    // Check if any single answer has BOTH verified AND rejected signals (contested)
    const hasContestedAnswer = question.answers.some((a) => {
        const hasVerif = a.signals.some((s) => s.type === 'verified');
        const hasRej = a.signals.some((s) => s.type === 'rejected');
        return hasVerif && hasRej;
    });
    if (hasContestedAnswer)
        return 'contested';
    const hasVerified = question.answers.some((a) => a.signals.some((s) => s.type === 'verified'));
    if (hasVerified)
        return 'verified';
    return 'candidate';
}
function generateId(prefix) {
    return `${prefix}_${(0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 16)}`;
}
function postQuestion(input, agentMetadata) {
    if (!input.title?.trim()) {
        throw new Error('Question title is required');
    }
    if (!input.problem?.trim()) {
        throw new Error('Question problem description is required');
    }
    if (!input.repository?.trim()) {
        throw new Error('repository is required');
    }
    if (!input.branch?.trim()) {
        throw new Error('branch is required');
    }
    if (!input.author?.trim()) {
        throw new Error('author is required');
    }
    if (!input.authorSessionName?.trim()) {
        throw new Error('authorSessionName is required');
    }
    const now = Math.floor(Date.now() / 1000);
    const question = {
        id: generateId('q'),
        title: input.title,
        problem: input.problem,
        repository: input.repository,
        branch: input.branch,
        keywords: input.keywords || [],
        askedBy: input.author,
        askedBySessionName: input.authorSessionName,
        agentMetadata,
        createdAt: now,
        updatedAt: now,
        version: 1,
        answers: [],
        comments: [],
        status: 'open',
    };
    (0, storage_1.saveQuestion)(question);
    (0, analytics_1.trackEvent)('question_posted', {
        questionId: question.id,
        title: question.title,
        keywords: question.keywords,
    }, {
        questionId: question.id,
        userId: input.author,
    });
    return question;
}
function postAnswer(question, input, agentMetadata) {
    if (!input.text?.trim()) {
        throw new Error('Answer text is required');
    }
    if (!input.author?.trim()) {
        throw new Error('author is required');
    }
    if (!input.authorSessionName?.trim()) {
        throw new Error('authorSessionName is required');
    }
    // 1. Load fresh copy to verify version (immutable pattern)
    const fresh = (0, storage_1.loadQuestion)(question.id);
    if (!fresh) {
        throw new Error(`Question ${question.id} not found`);
    }
    if (fresh.version !== question.version) {
        throw new Error(`Version mismatch for question ${question.id}: expected ${question.version}, but found ${fresh.version}. Your changes conflict with another update.`);
    }
    // 2. Create new question object (don't mutate caller's)
    const updated = structuredClone(fresh);
    const answer = {
        id: generateId('a'),
        text: input.text,
        author: input.author,
        authorSessionName: input.authorSessionName,
        agentMetadata,
        createdAt: Math.floor(Date.now() / 1000),
        signals: [],
    };
    // 3. Mutate the CLONE, not the original
    updated.answers.push(answer);
    updated.status = computeQuestionStatus(updated);
    updated.version++;
    updated.updatedAt = Math.floor(Date.now() / 1000);
    // 4. Save the clone with version check
    (0, storage_1.checkVersionAndSave)(updated, fresh.version);
    (0, analytics_1.trackEvent)('answer_posted', {
        answerId: answer.id,
        questionId: question.id,
        answerLength: input.text.length,
    }, {
        answerId: answer.id,
        questionId: question.id,
        userId: input.author,
    });
    // 5. Load the saved question and return both answer and updated question
    const saved = (0, storage_1.loadQuestion)(question.id);
    if (!saved) {
        throw new Error(`Failed to load saved question ${question.id}`);
    }
    return { answer, updatedQuestion: saved };
}
function verifyAnswer(question, input) {
    if (!input.evidence?.trim()) {
        throw new Error('Verification evidence is required. Describe what you tested and what the results were.');
    }
    // 1. Load fresh copy to verify version (immutable pattern)
    const fresh = (0, storage_1.loadQuestion)(question.id);
    if (!fresh) {
        throw new Error(`Question ${question.id} not found`);
    }
    if (fresh.version !== question.version) {
        throw new Error(`Version mismatch for question ${question.id}: expected ${question.version}, but found ${fresh.version}. Your changes conflict with another update.`);
    }
    // Find answer in fresh copy
    const answer = fresh.answers.find((a) => a.id === input.answerId);
    if (!answer) {
        throw new Error(`Answer ${input.answerId} not found`);
    }
    // Check if this session has already verified this answer
    const alreadyVerified = answer.signals.some((s) => s.type === 'verified' && s.sessionId === input.sessionId);
    if (alreadyVerified) {
        throw new Error(`Session ${input.sessionId} has already verified answer ${input.answerId}`);
    }
    // 2. Create new question object (don't mutate caller's)
    const updated = structuredClone(fresh);
    const updatedAnswer = updated.answers.find((a) => a.id === input.answerId);
    if (!updatedAnswer) {
        throw new Error(`Answer ${input.answerId} not found in cloned question`);
    }
    const signal = {
        type: 'verified',
        sessionId: input.sessionId,
        evidence: input.evidence,
        createdAt: Math.floor(Date.now() / 1000),
    };
    // 3. Mutate the CLONE, not the original
    updatedAnswer.signals.push(signal);
    updated.status = computeQuestionStatus(updated);
    updated.version++;
    updated.updatedAt = Math.floor(Date.now() / 1000);
    // 4. Save the clone with version check
    (0, storage_1.checkVersionAndSave)(updated, fresh.version);
    (0, analytics_1.trackEvent)('answer_verified', {
        answerId: answer.id,
        questionId: question.id,
        evidenceLength: input.evidence.length,
        timeToVerification: signal.createdAt - fresh.createdAt,
    }, {
        answerId: answer.id,
        questionId: question.id,
        sessionId: input.sessionId,
    });
    // 5. Load the saved question and return both signal and updated question
    const saved = (0, storage_1.loadQuestion)(question.id);
    if (!saved) {
        throw new Error(`Failed to load saved question ${question.id}`);
    }
    return { signal, updatedQuestion: saved };
}
function rejectAnswer(question, input) {
    if (!input.reason?.trim()) {
        throw new Error('Rejection reason is required. Explain why this answer doesn\'t work in your context.');
    }
    // 1. Load fresh copy to verify version (immutable pattern)
    const fresh = (0, storage_1.loadQuestion)(question.id);
    if (!fresh) {
        throw new Error(`Question ${question.id} not found`);
    }
    if (fresh.version !== question.version) {
        throw new Error(`Version mismatch for question ${question.id}: expected ${question.version}, but found ${fresh.version}. Your changes conflict with another update.`);
    }
    // Find answer in fresh copy
    const answer = fresh.answers.find((a) => a.id === input.answerId);
    if (!answer) {
        throw new Error(`Answer ${input.answerId} not found`);
    }
    // Check if this session has already rejected this answer
    const alreadyRejected = answer.signals.some((s) => s.type === 'rejected' && s.sessionId === input.sessionId);
    if (alreadyRejected) {
        throw new Error(`Session ${input.sessionId} has already rejected answer ${input.answerId}`);
    }
    // 2. Create new question object (don't mutate caller's)
    const updated = structuredClone(fresh);
    const updatedAnswer = updated.answers.find((a) => a.id === input.answerId);
    if (!updatedAnswer) {
        throw new Error(`Answer ${input.answerId} not found in cloned question`);
    }
    const signal = {
        type: 'rejected',
        sessionId: input.sessionId,
        reason: input.reason,
        createdAt: Math.floor(Date.now() / 1000),
    };
    // 3. Mutate the CLONE, not the original
    updatedAnswer.signals.push(signal);
    updated.status = computeQuestionStatus(updated);
    updated.version++;
    updated.updatedAt = Math.floor(Date.now() / 1000);
    // 4. Save the clone with version check
    (0, storage_1.checkVersionAndSave)(updated, fresh.version);
    (0, analytics_1.trackEvent)('answer_rejected', {
        answerId: answer.id,
        questionId: question.id,
        reasonLength: input.reason.length,
    }, {
        answerId: answer.id,
        questionId: question.id,
        sessionId: input.sessionId,
    });
    // 5. Load the saved question and return both signal and updated question
    const saved = (0, storage_1.loadQuestion)(question.id);
    if (!saved) {
        throw new Error(`Failed to load saved question ${question.id}`);
    }
    return { signal, updatedQuestion: saved };
}
function getVerifiedAnswer(question) {
    // Filter answers that have verified signals
    const verifiedAnswers = question.answers.filter((a) => a.signals.some((s) => s.type === 'verified'));
    if (verifiedAnswers.length === 0) {
        return null;
    }
    // Score each verified answer:
    // - verifiedCount * 10 dominates (each verification worth 10 points)
    // - rejectedCount * 5 penalty (each rejection worth -5 points)
    // - recency as a minimal tie-breaker (normalized to 0-1 range, max 0.1 bonus)
    const scoredAnswers = verifiedAnswers.map((answer) => {
        const verifiedCount = answer.signals.filter((s) => s.type === 'verified').length;
        const rejectedCount = answer.signals.filter((s) => s.type === 'rejected').length;
        // Normalize recency to a small tie-breaker (0-1, then scale to 0-0.1)
        // Older answers: lower recency bonus; newer answers: higher recency bonus
        // Find the max createdAt among all verified answers to normalize
        const maxCreatedAt = Math.max(...verifiedAnswers.map((a) => a.createdAt));
        const minCreatedAt = Math.min(...verifiedAnswers.map((a) => a.createdAt));
        const timeRange = maxCreatedAt - minCreatedAt;
        const recencyNormalized = timeRange > 0
            ? (answer.createdAt - minCreatedAt) / timeRange
            : 0.5; // If all same age, neutral tie-breaker
        const recencyBonus = recencyNormalized * 0.1; // Max 0.1 bonus
        const score = verifiedCount * 10 - rejectedCount * 5 + recencyBonus;
        return { answer, score };
    });
    // Sort by score descending
    scoredAnswers.sort((a, b) => b.score - a.score);
    // Return highest scored answer
    return scoredAnswers[0].answer;
}
function getQuestion(questionId) {
    return (0, storage_1.loadQuestion)(questionId);
}
function getAllQuestions() {
    return (0, storage_1.listAllQuestions)();
}
function getQuestionsByStatus(status) {
    return getAllQuestions().filter((q) => q.status === status);
}
function getVerifiedQuestions() {
    return getQuestionsByStatus('verified');
}
function getContestedQuestions() {
    return getQuestionsByStatus('contested');
}
function getUnansweredQuestions() {
    return getQuestionsByStatus('open');
}
function getOrCreateSession(id, name, repository) {
    return {
        id,
        name,
        repository,
    };
}
function searchQuestionsInProject(query) {
    const normalizedQuery = query.toLowerCase();
    const queryTerms = normalizedQuery.split(/\s+/).filter(t => t.length > 0);
    // Return empty results if query is empty
    if (queryTerms.length === 0) {
        return [];
    }
    const questions = getAllQuestions();
    const results = [];
    for (const question of questions) {
        const matchedKeywords = [];
        let relevance = 0;
        const titleLower = question.title.toLowerCase();
        const problemLower = question.problem.toLowerCase();
        // Per-term matching with bonuses for full phrase
        // Title: +3 per term, +7 bonus for full phrase
        for (const term of queryTerms) {
            if (titleLower.includes(term)) {
                matchedKeywords.push(term);
                relevance += 3;
            }
        }
        if (queryTerms.length > 1 && titleLower.includes(normalizedQuery)) {
            relevance += 7;
        }
        // Problem: +2 per term, +3 bonus for full phrase
        for (const term of queryTerms) {
            if (problemLower.includes(term)) {
                matchedKeywords.push(term);
                relevance += 2;
            }
        }
        if (queryTerms.length > 1 && problemLower.includes(normalizedQuery)) {
            relevance += 3;
        }
        // Keywords: +0.5 per term match
        for (const keyword of question.keywords) {
            const keywordLower = keyword.toLowerCase();
            for (const term of queryTerms) {
                if (keywordLower.includes(term)) {
                    matchedKeywords.push(keyword);
                    relevance += 0.5;
                    break; // Only count each keyword once
                }
            }
        }
        // Answer text: +0.5 per term match
        for (const answer of question.answers) {
            const answerLower = answer.text.toLowerCase();
            for (const term of queryTerms) {
                if (answerLower.includes(term)) {
                    relevance += 0.5;
                    break; // Count each answer only once per query
                }
            }
        }
        const textRelevance = relevance;
        // Only apply status/signal bonuses if there's at least one text match.
        // This prevents unrelated solved questions from appearing in search results
        if (textRelevance > 0) {
            // Add solution usefulness weighting (after text relevance)
            // Verified status: +20 points (most useful)
            // Contested status: +15 points (has solutions but conflicts)
            // Candidate status: +10 points (has answers, being tested)
            // Open status: 0 points (no solutions yet)
            if (question.status === 'verified') {
                relevance += 20;
            }
            else if (question.status === 'contested') {
                relevance += 15;
            }
            else if (question.status === 'candidate') {
                relevance += 10;
            }
            // Count verified signals across all answers: +5 per verified signal
            let verifiedCount = 0;
            for (const answer of question.answers) {
                for (const signal of answer.signals) {
                    if (signal.type === 'verified') {
                        verifiedCount++;
                    }
                }
            }
            relevance += verifiedCount * 5;
            // Count rejected signals: -2 per rejected signal
            let rejectedCount = 0;
            for (const answer of question.answers) {
                for (const signal of answer.signals) {
                    if (signal.type === 'rejected') {
                        rejectedCount++;
                    }
                }
            }
            relevance -= rejectedCount * 2;
        }
        if (relevance > 0) {
            results.push({
                question,
                relevance,
                matchedKeywords: [...new Set(matchedKeywords)],
            });
        }
    }
    // Sort by relevance (descending)
    results.sort((a, b) => b.relevance - a.relevance);
    // Track search_performed event
    const topRelevance = results.length > 0 ? results[0].relevance : 0;
    (0, analytics_1.trackEvent)('search_performed', {
        query,
        resultCount: results.length,
        topRelevance,
    });
    return results;
}
function postComment(question, text, author, authorSessionName, agentMetadata) {
    if (!text?.trim()) {
        throw new Error('Comment text is required');
    }
    if (!author?.trim()) {
        throw new Error('author is required');
    }
    if (!authorSessionName?.trim()) {
        throw new Error('authorSessionName is required');
    }
    // 1. Load fresh copy to verify version (immutable pattern)
    const fresh = (0, storage_1.loadQuestion)(question.id);
    if (!fresh) {
        throw new Error(`Question ${question.id} not found`);
    }
    if (fresh.version !== question.version) {
        throw new Error(`Version mismatch for question ${question.id}: expected ${question.version}, but found ${fresh.version}. Your changes conflict with another update.`);
    }
    // 2. Create new question object (don't mutate caller's)
    const updated = structuredClone(fresh);
    const comment = {
        id: generateId('cmt'),
        text,
        author,
        authorSessionName,
        agentMetadata,
        createdAt: Math.floor(Date.now() / 1000),
    };
    // 3. Mutate the CLONE, not the original
    updated.comments.push(comment);
    updated.version++;
    updated.updatedAt = Math.floor(Date.now() / 1000);
    // 4. Save the clone with version check
    (0, storage_1.checkVersionAndSave)(updated, fresh.version);
    (0, analytics_1.trackEvent)('comment_posted', {
        commentId: comment.id,
        questionId: question.id,
        commentLength: text.length,
    }, {
        questionId: question.id,
        userId: author,
    });
    // 5. Load the saved question and return both comment and updated question
    const saved = (0, storage_1.loadQuestion)(question.id);
    if (!saved) {
        throw new Error(`Failed to load saved question ${question.id}`);
    }
    return { comment, updatedQuestion: saved };
}
