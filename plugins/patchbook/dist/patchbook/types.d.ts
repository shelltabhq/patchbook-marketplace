export interface AgentMetadata {
    model: string;
    provider: string;
    systemVersion?: string;
    commitSha?: string;
    branch?: string;
    dependencyVersions?: Record<string, string>;
}
export type AnswerSignal = {
    type: "verified";
    sessionId: string;
    evidence: string;
    createdAt: number;
} | {
    type: "rejected";
    sessionId: string;
    reason: string;
    createdAt: number;
};
export interface Answer {
    id: string;
    text: string;
    author: string;
    authorSessionName: string;
    agentMetadata: AgentMetadata;
    createdAt: number;
    updatedAt?: number;
    signals: AnswerSignal[];
    supersededBy?: string;
    appliesTo?: Record<string, string>;
}
export interface Comment {
    id: string;
    text: string;
    author: string;
    authorSessionName: string;
    agentMetadata: AgentMetadata;
    createdAt: number;
}
export type QuestionStatus = "open" | "candidate" | "verified" | "contested" | "duplicate" | "stale";
export interface Question {
    id: string;
    title: string;
    problem: string;
    repository: string;
    branch: string;
    keywords: string[];
    askedBy: string;
    askedBySessionName: string;
    agentMetadata: AgentMetadata;
    createdAt: number;
    updatedAt: number;
    version: number;
    answers: Answer[];
    comments: Comment[];
    status: QuestionStatus;
    duplicateOf?: string;
}
export interface SearchIndex {
    questionId: string;
    keywords: string[];
    title: string;
    problem: string;
    lastIndexedAt: number;
}
export interface SearchResult {
    question: Question;
    relevance: number;
    matchedKeywords: string[];
}
export interface PatchbookConfig {
    projectRoot: string;
    repositoryName: string;
}
