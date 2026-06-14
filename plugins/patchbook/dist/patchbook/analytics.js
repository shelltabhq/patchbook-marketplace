"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackEvent = trackEvent;
exports.getAnalyticsEvents = getAnalyticsEvents;
exports.calculateVerificationRate = calculateVerificationRate;
exports.calculateTimeToVerification = calculateTimeToVerification;
exports.calculateMetrics = calculateMetrics;
const storage_1 = require("./storage");
const crypto_1 = require("crypto");
function generateAnalyticsId() {
    return `evt_${(0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 12)}`;
}
function trackEvent(eventType, data, metadata) {
    const event = {
        id: generateAnalyticsId(),
        eventType,
        timestamp: Math.floor(Date.now() / 1000),
        data,
        metadata,
    };
    try {
        (0, storage_1.saveAnalyticsEvent)(event.id, event);
    }
    catch (error) {
        console.error('Failed to save analytics event:', error);
    }
    return event;
}
function getAnalyticsEvents(eventType, limit) {
    try {
        const allEvents = (0, storage_1.listAnalyticsEvents)();
        let events = allEvents;
        if (eventType) {
            events = events.filter((e) => e.eventType === eventType);
        }
        if (limit) {
            return events.slice(-limit);
        }
        return events;
    }
    catch (error) {
        console.error('Failed to load analytics events:', error);
        return [];
    }
}
function calculateVerificationRate(questions) {
    if (questions.length === 0)
        return 0;
    const verifiedQuestions = questions.filter((q) => q.status === 'verified').length;
    return (verifiedQuestions / questions.length) * 100;
}
function calculateTimeToVerification(questions) {
    const verifiedQuestions = questions.filter((q) => {
        const verified = q.answers.find((a) => a.signals.some((s) => s.type === 'verified'));
        return verified !== undefined;
    });
    if (verifiedQuestions.length === 0)
        return null;
    let totalTime = 0;
    let count = 0;
    for (const question of verifiedQuestions) {
        // Find the earliest verification signal across all answers for this question
        let earliestVerificationTime = null;
        for (const answer of question.answers) {
            const verifiedSignal = answer.signals.find((s) => s.type === 'verified');
            if (verifiedSignal) {
                // Time from question creation to first verified answer
                const timeDiff = verifiedSignal.createdAt - question.createdAt;
                if (earliestVerificationTime === null || timeDiff < earliestVerificationTime) {
                    earliestVerificationTime = timeDiff;
                }
            }
        }
        if (earliestVerificationTime !== null) {
            totalTime += earliestVerificationTime;
            count++;
        }
    }
    return count > 0 ? totalTime / count : null;
}
function calculateMetrics(questions) {
    const totalQuestions = questions.length;
    const totalAnswers = questions.reduce((sum, q) => sum + q.answers.length, 0);
    const totalComments = questions.reduce((sum, q) => sum + q.comments.length, 0);
    const verificationRate = calculateVerificationRate(questions);
    const averageTimeToVerification = calculateTimeToVerification(questions);
    // Count questions by status
    const questionsByStatus = {};
    for (const question of questions) {
        questionsByStatus[question.status] =
            (questionsByStatus[question.status] || 0) + 1;
    }
    // Count events by type
    const eventCounts = {
        question_posted: 0,
        answer_posted: 0,
        comment_posted: 0,
        answer_verified: 0,
        answer_rejected: 0,
        search_performed: 0,
    };
    for (const event of getAnalyticsEvents()) {
        eventCounts[event.eventType]++;
    }
    // Get top event types
    const topEventTypes = Object.entries(eventCounts)
        .map(([type, count]) => ({
        type: type,
        count,
    }))
        .sort((a, b) => b.count - a.count);
    return {
        totalQuestions,
        totalAnswers,
        totalComments,
        verificationRate,
        averageTimeToVerification,
        questionsByStatus,
        eventCounts,
        topEventTypes,
    };
}
