export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ThreadInfo {
  id: string;
  preview?: string;
  createdAt?: number;
  modelProvider?: string;
}

export type ApprovalPolicy = "on-request" | "never";

export interface ModelOption {
  value: string;
  label: string;
}

export type ReasoningEffort = "low" | "medium" | "high";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface ThreadSettings {
  model: string;
  reasoningEffort: ReasoningEffort;
  sandbox: SandboxMode;
  mode: ModeKind;
}

export type MessageRole = "user" | "assistant" | "tool" | "approval";
export type MessageKind =
  | "reasoning"
  | "command"
  | "file"
  | "mcp"
  | "web"
  | "review"
  | "image"
  | "terminal"
  | "wait"
  | "approval-request"
  | "user-input-request"
  | "plan"
  | "collab"
  | "compaction";

export interface MessageMetadata {
  filePath?: string;
  exitCode?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface ApprovalRequest {
  id: string;
  rpcId: number; // The JSON-RPC request ID to respond to
  type: "command" | "file" | "mcp" | "other";
  description: string;
  command?: string;
  filePath?: string;
  toolName?: string;
  reason?: string;
  status: "pending" | "approved" | "declined" | "cancelled";
}

export interface UserInputOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: UserInputOption[];
}

export interface UserInputRequest {
  rpcId: number;
  questions: UserInputQuestion[];
  status: "pending" | "answered";
}

export interface Message {
  id: string;
  role: MessageRole;
  kind?: MessageKind;
  text: string;
  threadId: string;
  language?: string;
  metadata?: MessageMetadata;
  approval?: ApprovalRequest;
  userInputRequest?: UserInputRequest;
  planStatus?: "pending" | "approved";
}

// JSON-RPC style message envelope
export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

// Turn status
export type TurnStatus = "InProgress" | "Completed" | "Interrupted" | "Failed";

// Plan step
export type PlanStepStatus = "Pending" | "InProgress" | "Completed";

export interface PlanStep {
  step: string;
  status: PlanStepStatus;
}

// Planning questions
export type PlanningQuestionType = "choice" | "multi" | "text" | "scale" | "confirm";

export interface PlanningQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface PlanningQuestion {
  id: string;
  type: PlanningQuestionType;
  question: string;
  options?: PlanningQuestionOption[];
  min?: number;
  max?: number;
  labels?: [string, string];
  placeholder?: string;
}

export interface PlanningAnswer {
  questionId: string;
  value: string | string[] | number | boolean;
}

export type PlanningPhase = "design" | "review" | "final";

export type ModeKind = "plan" | "code";

export interface CollaborationMode {
  mode: ModeKind;
  settings: {
    model: string;
    reasoning_effort?: ReasoningEffort;
    developer_instructions?: string;
  };
}

export interface CollaborationModeMask {
  name: string;
  mode?: ModeKind;
  model?: string;
  reasoning_effort?: ReasoningEffort | null;
  developer_instructions?: string | null;
}
