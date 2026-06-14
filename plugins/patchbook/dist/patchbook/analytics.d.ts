import { Question } from './types';
export type AnalyticsEventType = 'question_posted' | 'answer_posted' | 'comment_posted' | 'answer_verified' | 'answer_rejected' | 'search_performed';
export interface AnalyticsEvent {
    id: string;
    eventType: AnalyticsEventType;
    timestamp: number;
    data: Record<string, unknown>;
    metadata?: {
        sessionId?: string;
        userId?: string;
        questionId?: string;
        answerId?: string;
    };
}
export declare function trackEvent(eventType: AnalyticsEventType, data: Record<string, unknown>, metadata?: AnalyticsEvent['metadata']): AnalyticsEvent;
export declare function getAnalyticsEvents(eventType?: AnalyticsEventType, limit?: number): AnalyticsEvent[];
export declare function calculateVerificationRate(questions: Question[]): number;
export declare function calculateTimeToVerification(questions: Question[]): number | null;
export interface MetricsReport {
    totalQuestions: number;
    totalAnswers: number;
    totalComments: number;
    verificationRate: number;
    averageTimeToVerification: number | null;
    questionsByStatus: Record<string, number>;
    eventCounts: Record<AnalyticsEventType, number>;
    topEventTypes: Array<{
        type: AnalyticsEventType;
        count: number;
    }>;
}
export declare function calculateMetrics(questions: Question[]): MetricsReport;
