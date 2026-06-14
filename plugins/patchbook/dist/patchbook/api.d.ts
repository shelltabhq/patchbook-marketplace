import { AgentMetadata, Answer, AnswerSignal, Comment, Question, QuestionStatus, SearchResult } from './types';
export declare function captureAgentMetadata(): AgentMetadata;
export declare function computeQuestionStatus(question: Question): QuestionStatus;
export interface PostQuestionInput {
    title: string;
    problem: string;
    repository: string;
    branch: string;
    keywords?: string[];
    author: string;
    authorSessionName: string;
}
export declare function postQuestion(input: PostQuestionInput, agentMetadata: AgentMetadata): Question;
export interface PostAnswerInput {
    text: string;
    author: string;
    authorSessionName: string;
}
export declare function postAnswer(question: Question, input: PostAnswerInput, agentMetadata: AgentMetadata): {
    answer: Answer;
    updatedQuestion: Question;
};
export interface VerifyAnswerInput {
    answerId: string;
    sessionId: string;
    evidence: string;
}
export declare function verifyAnswer(question: Question, input: VerifyAnswerInput): {
    signal: Extract<AnswerSignal, {
        type: 'verified';
    }>;
    updatedQuestion: Question;
};
export interface RejectAnswerInput {
    answerId: string;
    sessionId: string;
    reason: string;
}
export declare function rejectAnswer(question: Question, input: RejectAnswerInput): {
    signal: AnswerSignal;
    updatedQuestion: Question;
};
export declare function getVerifiedAnswer(question: Question): Answer | null;
export declare function getQuestion(questionId: string): Question | null;
export declare function getAllQuestions(): Question[];
export declare function getQuestionsByStatus(status: QuestionStatus): Question[];
export declare function getVerifiedQuestions(): Question[];
export declare function getContestedQuestions(): Question[];
export declare function getUnansweredQuestions(): Question[];
export interface Session {
    id: string;
    name: string;
    repository: string;
}
export declare function getOrCreateSession(id: string, name: string, repository: string): Session;
export declare function searchQuestionsInProject(query: string): SearchResult[];
export declare function postComment(question: Question, text: string, author: string, authorSessionName: string, agentMetadata: AgentMetadata): {
    comment: Comment;
    updatedQuestion: Question;
};
