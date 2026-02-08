import type { Message, RpcMessage, ApprovalRequest, UserInputRequest, UserInputQuestion, TurnStatus, PlanStep, CollaborationMode } from "./types";
import { socket } from "./socket.svelte";
import { threads } from "./threads.svelte";
import { api } from "./api";
import { auth } from "./auth.svelte";

const STORE_KEY = "__zane_messages_store__";

type ReasoningMode = "summary" | "raw";
interface ReasoningState {
  buffer: string;
  full: string;
  mode: ReasoningMode | null;
  header: string | null;
}

type TurnCompleteCallback = (threadId: string, finalText: string) => void;

class MessagesStore {
  #byThread = $state<Map<string, Message[]>>(new Map());
  #streamingText = $state<Map<string, string>>(new Map());
  #loadedThreads = new Set<string>();
  // Best-effort replay guard so we don't re-run expensive event hydration loops.
  #eventsReplayed = new Set<string>();
  #pendingApprovals = $state<Map<string, ApprovalRequest>>(new Map());
  #pendingLiveMessages = new Map<string, Message>(); // survives clearThread for replay preservation
  #reasoningByThread = new Map<string, ReasoningState>();
  #execCommands = new Map<string, string>();
  #turnCompleteCallbacks = new Map<string, TurnCompleteCallback>();
  #pendingAgentMessageIds = new Map<string, string>();

  #textFromContent(value: unknown): string {
    // Codex content shapes vary by version:
    // - [{type:"text", text:"..."}]
    // - {type:"text", text:"..."}
    // - "..."
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const part of value as any[]) {
        if (part && typeof part === "object" && (part as any).type === "text" && typeof (part as any).text === "string") {
          return (part as any).text as string;
        }
      }
      return "";
    }
    if (value && typeof value === "object") {
      const v: any = value;
      if (typeof v.text === "string") return v.text;
      if (Array.isArray(v.content)) return this.#textFromContent(v.content);
    }
    return "";
  }

  // Last observed activity time (unix seconds) per thread. Used for sorting thread list.
  #lastActivityByThread = $state<Map<string, number>>(new Map());

  // Streaming reasoning state (per-thread)
  #streamingReasoningTextByThread = $state<Map<string, string>>(new Map());
  #isReasoningStreamingByThread = $state<Map<string, boolean>>(new Map());

  // Turn state (per-thread)
  #turnIdByThread = $state<Map<string, string | null>>(new Map());
  #turnStatusByThread = $state<Map<string, TurnStatus | null>>(new Map());
  #interruptPendingByThread = new Map<string, boolean>();
  #planByThread = $state<Map<string, PlanStep[]>>(new Map());
  #planExplanationByThread = $state<Map<string, string | null>>(new Map());
  #statusDetailByThread = $state<Map<string, string | null>>(new Map());

  // Convenience getters for the currently-open thread
  get turnStatus() {
    const id = threads.currentId;
    return id ? this.getTurnStatus(id) : null;
  }
  get plan() {
    const id = threads.currentId;
    return id ? this.getPlan(id) : [];
  }
  get planExplanation() {
    const id = threads.currentId;
    return id ? this.getPlanExplanation(id) : null;
  }
  get statusDetail() {
    const id = threads.currentId;
    return id ? this.getStatusDetail(id) : null;
  }
  get isReasoningStreaming() {
    const id = threads.currentId;
    return id ? this.getIsReasoningStreaming(id) : false;
  }
  get streamingReasoningText() {
    const id = threads.currentId;
    return id ? this.getStreamingReasoningText(id) : "";
  }

  // Per-thread accessors (used to allow multiple threads to run concurrently)
  getTurnId(threadId: string): string | null {
    return this.#turnIdByThread.get(threadId) ?? null;
  }
  getTurnStatus(threadId: string): TurnStatus | null {
    return this.#turnStatusByThread.get(threadId) ?? null;
  }
  getPlan(threadId: string): PlanStep[] {
    return this.#planByThread.get(threadId) ?? [];
  }
  getPlanExplanation(threadId: string): string | null {
    return this.#planExplanationByThread.get(threadId) ?? null;
  }
  getStatusDetail(threadId: string): string | null {
    return this.#statusDetailByThread.get(threadId) ?? null;
  }
  getIsReasoningStreaming(threadId: string): boolean {
    return this.#isReasoningStreamingByThread.get(threadId) ?? false;
  }
  getStreamingReasoningText(threadId: string): string {
    return this.#streamingReasoningTextByThread.get(threadId) ?? "";
  }

  getLastActivity(threadId: string): number | null {
    return this.#lastActivityByThread.get(threadId) ?? null;
  }

  getThreadIndicator(threadId: string): "blocked" | "working" | "idle" {
    // "blocked" means a turn is waiting on user action (approval / user input).
    // "working" means the model is actively running.
    // "idle" means nothing is currently pending.
    const msgs = this.getThreadMessages(threadId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i] as any;
      if (m?.kind === "approval-request" && m?.approval?.status === "pending") return "blocked";
      if (m?.kind === "user-input-request" && m?.userInputRequest?.status === "pending") return "blocked";
    }
    const status = (this.getTurnStatus(threadId) ?? "").toLowerCase();
    if (status === "inprogress") return "working";
    return "idle";
  }

  #touch(threadId: string) {
    // Use seconds to align with thread.createdAt format in thread/list.
    const now = Math.floor(Date.now() / 1000);
    const prev = this.#lastActivityByThread.get(threadId) ?? 0;
    if (now !== prev) {
      this.#lastActivityByThread = new Map(this.#lastActivityByThread).set(threadId, now);
    }
  }

  interrupt(threadId: string): { success: boolean; error?: string } {
    const turnId = this.getTurnId(threadId);
    const status = (this.getTurnStatus(threadId) ?? "").toLowerCase();
    if (!turnId || status != "inprogress") {
      return { success: true };
    }
    if (this.#interruptPendingByThread.get(threadId)) {
      return { success: true };
    }

    const result = socket.send({
      method: "turn/interrupt",
      id: Date.now(),
      params: { threadId, turnId },
    });

    if (result.success) {
      this.#interruptPendingByThread.set(threadId, true);
    }
    return result;
  }

  onTurnComplete(threadId: string, callback: TurnCompleteCallback): () => void {
    this.#turnCompleteCallbacks.set(threadId, callback);
    return () => {
      this.#turnCompleteCallbacks.delete(threadId);
    };
  }

  clearThread(threadId: string) {
    this.#byThread.delete(threadId);
    // Allow re-opening a thread to rehydrate history after we intentionally cleared it.
    this.#loadedThreads.delete(threadId);
    this.#eventsReplayed.delete(threadId);
    for (const key of this.#streamingText.keys()) {
      if (key.startsWith(`${threadId}:`)) {
        this.#streamingText.delete(key);
      }
    }
  }

  async rehydrateFromEvents(threadId: string) {
    // Best-effort transcript restore from Codex Pocket's local-orbit event store.
    // This is used when upstream thread/resume/thread/read does not replay history.
    if (!threadId) return;
    if (this.#eventsReplayed.has(threadId)) return;
    // If we don't yet have an auth token (common right after page load),
    // delay and retry rather than permanently failing.
    if (!auth.token) {
      setTimeout(() => void this.rehydrateFromEvents(threadId), 750);
      return;
    }

    // If the thread has large history, fetching the entire NDJSON payload can be enormous
    // (especially if `thread/read` results are persisted repeatedly). Keep this lightweight:
    // - ask local-orbit for a bounded number of recent events
    // - iterate without pre-splitting
    // - stop early once we successfully hydrate any messages
    const before = this.getThreadMessages(threadId).length;
    try {
      // local-orbit accepts token via query string as well as Authorization header.
      const tokenParam = encodeURIComponent(auth.token);
      // Prefer newest-first so we are more likely to encounter a recent `thread/read` snapshot early.
      // Keep the limit small: a single `thread/read` snapshot can be several MB, and large threads
      // can accumulate many of them over time.
      const text = await api.getText(`/threads/${threadId}/events?token=${tokenParam}&order=desc&limit=30`);
      if (!text.trim()) return;

      let i = 0;
      const n = text.length;
      while (i < n) {
        let j = text.indexOf("\n", i);
        if (j === -1) j = n;
        const line = text.slice(i, j).trim();
        i = j + 1;
        if (!line) continue;
        try {
          // local-orbit stores wrapper objects:
          // { ts, direction, message: <rpc> }
          const parsed = JSON.parse(line) as any;
          const msg: RpcMessage | null =
            parsed && typeof parsed === "object" && parsed.message && typeof parsed.message === "object"
              ? (parsed.message as RpcMessage)
              : parsed && typeof parsed === "object"
                ? (parsed as RpcMessage)
                : null;
          if (msg) this.handleMessage(msg);
          // Stop early once we have any transcript. This avoids long synchronous parsing
          // loops on large threads and prevents UI freezes that break navigation.
          if (this.getThreadMessages(threadId).length > before) break;
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore failures (no events yet, endpoint unavailable, etc.)
    } finally {
      const after = this.getThreadMessages(threadId).length;
      if (after > before) {
        this.#eventsReplayed.add(threadId);
      }
    }
  }

  get current(): Message[] {
    const threadId = threads.currentId;
    if (!threadId) return [];
    return this.#byThread.get(threadId) ?? [];
  }

  getThreadMessages(threadId: string | null): Message[] {
    if (!threadId) return [];
    return this.#byThread.get(threadId) ?? [];
  }

  getLatestAssistantMessage(threadId: string | null): Message | null {
    const messages = this.getThreadMessages(threadId);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.role === "assistant") return msg;
    }
    return null;
  }

  approve(approvalId: string, forSession = false, collaborationMode?: CollaborationMode) {
    const approval = this.#pendingApprovals.get(approvalId);
    if (!approval || approval.status !== "pending") return;

    approval.status = "approved";
    this.#pendingApprovals = new Map(this.#pendingApprovals);
    this.#updateApprovalInMessages(approvalId, "approved");

    // Send JSON-RPC response with decision enum per Codex protocol (lowercase!)
    const decision = forSession ? "acceptForSession" : "accept";
    socket.send({
      id: approval.rpcId,
      result: { decision, ...(collaborationMode ? { collaborationMode } : {}) },
    });
  }

  decline(approvalId: string, collaborationMode?: CollaborationMode) {
    const approval = this.#pendingApprovals.get(approvalId);
    if (!approval || approval.status !== "pending") return;

    approval.status = "declined";
    this.#pendingApprovals = new Map(this.#pendingApprovals);
    this.#updateApprovalInMessages(approvalId, "declined");

    // Decline = deny but let agent continue
    socket.send({
      id: approval.rpcId,
      result: { decision: "decline", ...(collaborationMode ? { collaborationMode } : {}) },
    });
  }

  cancel(approvalId: string) {
    const approval = this.#pendingApprovals.get(approvalId);
    if (!approval || approval.status !== "pending") return;

    approval.status = "cancelled";
    this.#pendingApprovals = new Map(this.#pendingApprovals);
    this.#updateApprovalInMessages(approvalId, "cancelled");

    // Cancel = deny and interrupt turn
    socket.send({
      id: approval.rpcId,
      result: { decision: "cancel" },
    });
  }

  respondToUserInput(messageId: string, answers: Record<string, string[]>, collaborationMode?: CollaborationMode) {
    this.#pendingLiveMessages.delete(messageId);

    const threadId = threads.currentId;
    if (!threadId) return;

    const msgs = this.#byThread.get(threadId) ?? [];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const msg = msgs[idx];
    if (!msg.userInputRequest || msg.userInputRequest.status !== "pending") return;

    const formattedAnswers: Record<string, { answers: string[] }> = {};
    for (const [questionId, selected] of Object.entries(answers)) {
      formattedAnswers[questionId] = { answers: selected };
    }

    socket.send({
      id: msg.userInputRequest.rpcId,
      result: { answers: formattedAnswers, ...(collaborationMode ? { collaborationMode } : {}) },
    });

    const updated = [...msgs];
    updated[idx] = {
      ...msgs[idx],
      userInputRequest: { ...msgs[idx].userInputRequest!, status: "answered" },
    };
    this.#byThread = new Map(this.#byThread).set(threadId, updated);
  }

  approvePlan(messageId: string) {
    const threadId = threads.currentId;
    if (!threadId) return;

    const msgs = this.#byThread.get(threadId) ?? [];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const updated = [...msgs];
    updated[idx] = { ...msgs[idx], planStatus: "approved" };
    this.#byThread = new Map(this.#byThread).set(threadId, updated);
  }

  #updateApprovalInMessages(approvalId: string, status: "approved" | "declined" | "cancelled") {
    this.#pendingLiveMessages.delete(`approval-${approvalId}`);

    const threadId = threads.currentId;
    if (!threadId) return;

    const messages = this.#byThread.get(threadId) ?? [];
    const idx = messages.findIndex((m) => m.approval?.id === approvalId);
    if (idx >= 0) {
      const updated = [...messages];
      updated[idx] = {
        ...messages[idx],
        approval: { ...messages[idx].approval!, status },
      };
      this.#byThread = new Map(this.#byThread).set(threadId, updated);
    }
  }

  #add(threadId: string, message: Message) {
    const existing = this.#byThread.get(threadId) ?? [];
    if (existing.some((m) => m.id === message.id)) {
      return;
    }
    this.#byThread.set(threadId, [...existing, message]);
    this.#byThread = new Map(this.#byThread);
  }

  #upsert(threadId: string, message: Message) {
    const existing = this.#byThread.get(threadId) ?? [];
    const idx = existing.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      const updated = [...existing];
      updated[idx] = { ...updated[idx], ...message };
      this.#byThread = new Map(this.#byThread).set(threadId, updated);
      return;
    }
    this.#byThread.set(threadId, [...existing, message]);
    this.#byThread = new Map(this.#byThread);
  }

  #remove(threadId: string, messageId: string) {
    const existing = this.#byThread.get(threadId) ?? [];
    const idx = existing.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const updated = [...existing];
    updated.splice(idx, 1);
    this.#byThread = new Map(this.#byThread).set(threadId, updated);
  }

  #appendToMessage(threadId: string, itemId: string, delta: string, role: Message["role"], kind?: Message["kind"]) {
    const key = `${threadId}:${itemId}`;
    const current = this.#streamingText.get(key) ?? "";
    this.#streamingText.set(key, current + delta);
    this.#streamingText = new Map(this.#streamingText);

    const messages = this.#byThread.get(threadId) ?? [];
    const idx = messages.findIndex((m) => m.id === itemId);
    const nextText = this.#streamingText.get(key) ?? "";

    if (idx >= 0) {
      const updated = [...messages];
      updated[idx] = { ...messages[idx], text: nextText };
      this.#byThread = new Map(this.#byThread).set(threadId, updated);
    } else {
      this.#upsert(threadId, {
        id: itemId,
        role,
        kind,
        text: nextText,
        threadId,
      });
    }
  }

  #updateStreaming(threadId: string, itemId: string, delta: string) {
    this.#appendToMessage(threadId, itemId, delta, "assistant");
  }

  #updateStreamingTool(threadId: string, itemId: string, delta: string, kind?: Message["kind"]) {
    const messages = this.#byThread.get(threadId) ?? [];
    const idx = messages.findIndex((m) => m.id === itemId);

    if (idx >= 0) {
      this.#appendToMessage(threadId, itemId, delta, messages[idx].role, messages[idx].kind ?? kind);
      return;
    }
    this.#appendToMessage(threadId, itemId, delta, "tool", kind);
  }

  #clearStreaming(threadId: string, itemId: string) {
    const key = `${threadId}:${itemId}`;
    if (this.#streamingText.delete(key)) {
      this.#streamingText = new Map(this.#streamingText);
    }
  }

  #getReasoningState(threadId: string): ReasoningState {
    const existing = this.#reasoningByThread.get(threadId);
    if (existing) return existing;
    const next: ReasoningState = { buffer: "", full: "", mode: null, header: null };
    this.#reasoningByThread.set(threadId, next);
    return next;
  }

  #resetReasoningState(threadId: string) {
    this.#reasoningByThread.set(threadId, { buffer: "", full: "", mode: null, header: null });
    this.#isReasoningStreamingByThread = new Map(this.#isReasoningStreamingByThread).set(threadId, false);
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, "");
  }

  #appendReasoningDelta(threadId: string, delta: string, mode: ReasoningMode) {
    const state = this.#getReasoningState(threadId);
    if (state.mode === "raw" && mode === "summary") return;
    if (!state.mode || mode === "raw") {
      state.mode = mode;
    }

    state.buffer += delta;

    // Update reactive streaming state
    this.#isReasoningStreamingByThread = new Map(this.#isReasoningStreamingByThread).set(threadId, true);
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, state.full + state.buffer);

    const header = this.#extractFirstBold(state.buffer);
    if (header) {
      state.header = header;
      this.#statusDetailByThread = new Map(this.#statusDetailByThread).set(threadId, header);
    }
  }

  #reasoningSectionBreak(threadId: string) {
    const state = this.#getReasoningState(threadId);
    if (state.buffer) {
      state.full += state.buffer;
      state.buffer = "";
    }
    state.full += "\n\n";
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, state.full);
  }

  #finaliseReasoning(threadId: string, item: Record<string, unknown>) {
    const state = this.#getReasoningState(threadId);
    if (state.buffer) {
      state.full += state.buffer;
      state.buffer = "";
    }

    const fromItem = this.#reasoningTextFromItem(item);
    const full = state.full.trim().length > 0 ? state.full : fromItem;

    state.full = "";
    state.mode = null;
    state.header = null;

    // Reset streaming state
    this.#isReasoningStreamingByThread = new Map(this.#isReasoningStreamingByThread).set(threadId, false);
    this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, "");

    const summary = this.#extractReasoningSummary(full);
    if (!summary) return;

    const itemId = (item.id as string) || `reasoning-${threadId}-${Date.now()}`;
    this.#upsert(threadId, {
      id: itemId,
      role: "assistant",
      kind: "reasoning",
      text: summary,
      threadId,
    });
  }

  #reasoningTextFromItem(item: Record<string, unknown>): string {
    const summary = Array.isArray(item.summary) ? item.summary.join("") : "";
    const content = Array.isArray(item.content) ? item.content.join("") : "";
    return (content || summary).trim();
  }

  #extractFirstBold(text: string): string | null {
    const match = text.match(/\*\*(.+?)\*\*/s);
    return match?.[1]?.trim() || null;
  }

  #extractReasoningSummary(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "";
    const open = trimmed.indexOf("**");
    if (open >= 0) {
      const afterOpen = trimmed.slice(open + 2);
      const close = afterOpen.indexOf("**");
      if (close >= 0) {
        const afterCloseIdx = open + 2 + close + 2;
        if (afterCloseIdx < trimmed.length) {
          return trimmed.slice(afterCloseIdx).trim();
        }
      }
    }
    return trimmed;
  }

  handleMessage(msg: RpcMessage) {
    if (msg.result && !msg.method) {
      // Thread history can come back in slightly different shapes depending on the upstream
      // Codex app-server version. Be permissive.
      const result = msg.result as any;
      const thread =
        result?.thread ??
        result?.data?.thread ??
        (result && typeof result === "object" && "id" in result && "turns" in result ? result : null);
      const turns: Array<{ items?: unknown[] }> | null =
        thread?.turns ??
        result?.turns ??
        result?.data?.turns ??
        result?.items ??
        null;

      const threadId: string | null =
        (thread?.id as string | undefined) ??
        (result?.threadId as string | undefined) ??
        (result?.thread_id as string | undefined) ??
        (result?.data?.threadId as string | undefined) ??
        (result?.data?.thread_id as string | undefined) ??
        null;

      if (threadId && Array.isArray(turns)) {
        this.#touch(threadId);
        // Do not require `existing.length === 0` here.
        // We can receive live `item/*` messages immediately after subscribing, which would
        // make `existing` non-empty and inadvertently block history loading, resulting in
        // a "blank thread" UX. History load dedupes by `id` anyway.
        if (!this.#loadedThreads.has(threadId)) {
          try {
            this.#loadThread(threadId, turns);
            this.#loadedThreads.add(threadId);
          } catch {
            // If history parsing throws, don't permanently mark this thread as loaded.
          }
        }
      }
      return;
    }

    const method = msg.method;
    const params = msg.params as Record<string, unknown> | undefined;
    if (!params) return;

    const threadId = this.#extractThreadId(params);
    if (!threadId) return;

    // Any event on this thread counts as "activity" for ordering.
    this.#touch(threadId);

    // Item started - handle user messages
    if (method === "item/started") {
      const item = params.item as Record<string, unknown>;
      if (!item) return;

      const type = item.type as string;
      if (type === "userMessage") {
        const itemId = item.id as string;
        const text = this.#textFromContent((item as any).content) || "";

        this.#add(threadId, {
          id: itemId,
          role: "user",
          text,
          threadId,
        });
      } else if (type === "commandExecution") {
        const itemId = item.id as string;
        const command = (item.command as string) || "";
        if (itemId && command) {
          this.#execCommands.set(itemId, command);
        }
      }
      return;
    }

    // Agent message delta (streaming)
    if (method === "item/agentMessage/delta") {
      const delta = (params.delta as string) || "";
      const providedId = (params.itemId as string) || (params.item_id as string);
      const itemId = providedId || `agent-${threadId}`;
      if (!providedId) {
        this.#pendingAgentMessageIds.set(threadId, itemId);
      }
      this.#updateStreaming(threadId, itemId, delta);
      return;
    }

    // Reasoning summary delta
    if (method === "item/reasoning/summaryTextDelta") {
      const delta = (params.delta as string) || "";
      if (delta) {
        this.#appendReasoningDelta(threadId, delta, "summary");
      }
      return;
    }

    // Reasoning content delta (raw)
    if (method === "item/reasoning/textDelta") {
      const delta = (params.delta as string) || "";
      if (delta) {
        this.#appendReasoningDelta(threadId, delta, "raw");
      }
      return;
    }

    // Reasoning section break
    if (method === "item/reasoning/summaryPartAdded") {
      this.#reasoningSectionBreak(threadId);
      return;
    }

    // Terminal interaction (interactive command)
    if (method === "item/commandExecution/terminalInteraction") {
      const stdin = (params.stdin as string) || "";
      const processId = (params.processId as string) || (params.process_id as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || "";
      const key = processId || itemId || `terminal-${threadId}`;
      const command = itemId ? this.#execCommands.get(itemId) : null;
      const waitingLine = command ? `(waiting for ${command})` : "(waiting for command output)";
      const waitId = `terminal-wait-${key}`;
      const messageId = `terminal-${key}`;
      const trimmed = stdin.replace(/\r?\n$/, "");

      if (!stdin) {
        this.#upsert(threadId, {
          id: waitId,
          role: "tool",
          kind: "wait",
          text: waitingLine,
          threadId,
        });
        return;
      }

      this.#remove(threadId, waitId);
      if (trimmed) {
        this.#appendToMessage(threadId, messageId, `${trimmed}\n`, "tool", "terminal");
      }
      return;
    }

    // Command execution output delta (streaming)
    if (method === "item/commandExecution/outputDelta") {
      const delta = (params.delta as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `cmd-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, delta, "command");
      return;
    }

    // File change output delta (streaming)
    if (method === "item/fileChange/outputDelta") {
      const delta = (params.delta as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `file-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, delta, "file");
      return;
    }

    // MCP tool call progress
    if (method === "item/mcpToolCall/progress") {
      const message = (params.message as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `mcp-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, message + "\n", "mcp");
      return;
    }

    // Plan item delta (streaming)
    if (method === "item/plan/delta") {
      const delta = (params.delta as string) || "";
      const itemId = (params.itemId as string) || (params.item_id as string) || `plan-${threadId}`;
      this.#updateStreamingTool(threadId, itemId, delta, "plan");
      return;
    }

    // Turn started
    if (method === "turn/started") {
      const turn = params.turn as { id: string; status?: string } | undefined;
      if (turn) {
        this.#turnIdByThread = new Map(this.#turnIdByThread).set(threadId, turn.id);
        this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, (turn.status as TurnStatus) || "InProgress");
        this.#interruptPendingByThread.set(threadId, false);
        this.#planByThread = new Map(this.#planByThread).set(threadId, []);
        this.#planExplanationByThread = new Map(this.#planExplanationByThread).set(threadId, null);
        this.#statusDetailByThread = new Map(this.#statusDetailByThread).set(threadId, null);
        this.#resetReasoningState(threadId);
      }
      return;
    }

    // Turn completed
    if (method === "turn/completed") {
      const turn = params.turn as { id: string; status?: string } | undefined;
      if (turn) {
        this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, (turn.status as TurnStatus) || "Completed");
        this.#interruptPendingByThread.set(threadId, false);
        this.#statusDetailByThread = new Map(this.#statusDetailByThread).set(threadId, null);
        this.#isReasoningStreamingByThread = new Map(this.#isReasoningStreamingByThread).set(threadId, false);
        this.#streamingReasoningTextByThread = new Map(this.#streamingReasoningTextByThread).set(threadId, "");

        // Clear pending live messages for this thread — turn is done
        for (const [id, msg] of this.#pendingLiveMessages) {
          if (msg.threadId === threadId) this.#pendingLiveMessages.delete(id);
        }

        // Fire turn complete callback if registered
        const callback = this.#turnCompleteCallbacks.get(threadId);
        if (callback) {
          const latestMessage = this.getLatestAssistantMessage(threadId);
          callback(threadId, latestMessage?.text ?? "");
          this.#turnCompleteCallbacks.delete(threadId);
        }
      }
      return;
    }

    // Turn plan updated
    if (method === "turn/plan/updated") {
      const explanation = params.explanation as string | undefined;
      const plan = params.plan as Array<{ step: string; status: string }> | undefined;

      if (explanation) {
        this.#planExplanationByThread = new Map(this.#planExplanationByThread).set(threadId, explanation);
      }
      if (plan) {
        this.#planByThread = new Map(this.#planByThread).set(threadId, plan.map((p) => ({
          step: p.step,
          status: p.status as PlanStep["status"],
        })));
      }
      return;
    }

    // User input requests (plan mode questions)
    if (method === "item/tool/requestUserInput") {
      const rpcId = msg.id as number;
      const itemId = (params.itemId as string) || (params.item_id as string) || `user-input-${Date.now()}`;
      const questions = (params.questions as UserInputQuestion[]) || [];

      // A pending request means a turn is actively waiting
      this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, "InProgress");

      const userInputRequest: UserInputRequest = {
        rpcId,
        questions,
        status: "pending",
      };

      const inputMsg: Message = {
        id: `user-input-${itemId}`,
        role: "assistant",
        kind: "user-input-request",
        text: questions.map((q) => q.question).join("\n"),
        threadId,
        userInputRequest,
      };
      this.#pendingLiveMessages.set(inputMsg.id, inputMsg);
      const existing = this.#byThread.get(threadId);
      if (!existing?.some((m) => m.id === inputMsg.id)) {
        this.#add(threadId, inputMsg);
      }
      return;
    }

    // Approval requests (file changes, commands, etc.)
    if (method?.includes("/requestApproval")) {
      const itemId = (params.itemId as string) || `approval-${Date.now()}`;
      const reason = (params.reason as string) || null;
      const rpcId = msg.id as number; // Capture the request ID for response

      // A pending approval means a turn is actively waiting
      this.#turnStatusByThread = new Map(this.#turnStatusByThread).set(threadId, "InProgress");

      // Determine type from method name
      let approvalType: ApprovalRequest["type"] = "other";
      let description = "";

      if (method === "item/fileChange/requestApproval") {
        approvalType = "file";
        description = reason || "File change requires approval";
      } else if (method === "item/commandExecution/requestApproval") {
        approvalType = "command";
        description = reason || "Command execution requires approval";
      } else if (method === "item/mcpToolCall/requestApproval") {
        approvalType = "mcp";
        description = reason || "MCP tool call requires approval";
      } else {
        description = reason || "Action requires approval";
      }

      const approval: ApprovalRequest = {
        id: itemId,
        rpcId, // Store the RPC ID so we can respond to it
        type: approvalType,
        description,
        status: "pending",
      };

      this.#pendingApprovals.set(itemId, approval);
      this.#pendingApprovals = new Map(this.#pendingApprovals);

      const approvalMsg: Message = {
        id: `approval-${itemId}`,
        role: "approval",
        kind: "approval-request",
        text: description,
        threadId,
        approval,
      };
      this.#pendingLiveMessages.set(approvalMsg.id, approvalMsg);
      const existing = this.#byThread.get(threadId);
      if (!existing?.some((m) => m.id === approvalMsg.id)) {
        this.#add(threadId, approvalMsg);
      }
      return;
    }

    // Item completed (tool outputs, file changes, commands)
    if (method === "item/completed") {
      const item = params.item as Record<string, unknown>;
      if (!item) return;

      const itemId = (item.id as string) || `item-${Date.now()}`;
      const type = item.type as string;

      switch (type) {
        case "agentMessage": {
          const text = ((item.text as string) || "").replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/g, "").trim();
          if (!text) return;
          const pendingId = this.#pendingAgentMessageIds.get(threadId);
          if (pendingId && pendingId !== itemId) {
            this.#remove(threadId, pendingId);
            this.#clearStreaming(threadId, pendingId);
          }
          this.#pendingAgentMessageIds.delete(threadId);
          this.#upsert(threadId, { id: itemId, role: "assistant", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "reasoning":
          this.#finaliseReasoning(threadId, item);
          return;
        case "commandExecution": {
          const command = (item.command as string) || "";
          const output = (item.aggregatedOutput as string) || "";
          const text = command ? `$ ${command}\n${output}` : output;
          const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
          this.#upsert(threadId, {
            id: itemId,
            role: "tool",
            kind: "command",
            text,
            threadId,
            metadata: exitCode !== null ? { exitCode } : undefined,
          });
          this.#clearStreaming(threadId, itemId);
          this.#execCommands.delete(itemId);
          return;
        }
        case "fileChange": {
          const changes = item.changes as Array<{ path: string; diff?: string }>;
          const text = changes?.map((c) => `${c.path}\n${c.diff || ""}`).join("\n\n") || "";
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "file", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "mcpToolCall": {
          const result = item.error ?? item.result ?? "";
          const text = `Tool: ${item.tool}\n${result ? JSON.stringify(result, null, 2) : ""}`;
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "mcp", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "webSearch": {
          const text = `Search: ${item.query}`;
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "web", text, threadId });
          return;
        }
        case "imageView": {
          const text = `Image: ${item.path ?? ""}`;
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "image", text, threadId });
          return;
        }
        case "enteredReviewMode": {
          const review = (item.review as string) || "";
          const text = review ? `Review started: ${review}` : "Review started.";
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "review", text, threadId });
          return;
        }
        case "exitedReviewMode": {
          const review = (item.review as string) || "";
          const text = review || "Review complete.";
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "review", text, threadId });
          return;
        }
        case "plan": {
          const text = ((item.text as string) || "").replace(/<\/?proposed_plan>/g, "").trim();
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "plan", text, threadId });
          this.#clearStreaming(threadId, itemId);
          return;
        }
        case "collabAgentToolCall": {
          const tool = (item.tool as string) || "spawnAgent";
          const receivers = (item.receiverThreadIds as string[]) || [];
          const prompt = (item.prompt as string) || "";
          const status = (item.status as string) || "completed";
          const lines = [`${tool}: ${receivers.join(", ") || "—"}`];
          if (prompt) lines.push(prompt);
          lines.push(`Status: ${status}`);
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "collab", text: lines.join("\n"), threadId });
          return;
        }
        case "contextCompaction": {
          this.#upsert(threadId, { id: itemId, role: "tool", kind: "compaction", text: "Context compacted", threadId });
          return;
        }
        default:
          return;
      }
    }
  }

  #extractThreadId(params: Record<string, unknown>): string | null {
    const direct = (params.threadId as string) || (params.thread_id as string);
    if (direct) return direct;

    // Codex payload shapes vary by version. Sometimes the thread id is nested under `thread.id`
    // or under `turn.threadId` / `turn.thread.id` / `item.threadId` / `item.thread.id`.
    const p: any = params;
    const fromTurnId =
      typeof p?.turn?.threadId === "string"
        ? (p.turn.threadId as string)
        : typeof p?.turn?.thread_id === "string"
          ? (p.turn.thread_id as string)
          : null;
    if (fromTurnId) return fromTurnId;

    const fromThread =
      p?.thread && typeof p.thread === "object" && typeof p.thread.id === "string" ? (p.thread.id as string) : null;
    if (fromThread) return fromThread;

    const fromTurnThread =
      p?.turn?.thread && typeof p.turn.thread === "object" && typeof p.turn.thread.id === "string"
        ? (p.turn.thread.id as string)
        : null;
    if (fromTurnThread) return fromTurnThread;

    const fromItemId =
      typeof p?.item?.threadId === "string"
        ? (p.item.threadId as string)
        : typeof p?.item?.thread_id === "string"
          ? (p.item.thread_id as string)
          : null;
    if (fromItemId) return fromItemId;

    const fromItemThread =
      p?.item?.thread && typeof p.item.thread === "object" && typeof p.item.thread.id === "string"
        ? (p.item.thread.id as string)
        : null;
    if (fromItemThread) return fromItemThread;

    return null;
  }

  #loadThread(threadId: string, turns: unknown[]) {
    const messages: Message[] = [];

    // Some upstreams return `turns: [{items:[...]}]` while others return `items: [...]`
    // directly. Normalize to a flat list of items.
    const items: Array<Record<string, unknown>> = [];
    const first = (turns as any[])[0];
    if (first && typeof first === "object" && Array.isArray((first as any).items)) {
      for (const turn of turns as Array<{ items?: unknown[] }>) {
        if (!turn.items) continue;
        for (const it of turn.items as Array<Record<string, unknown>>) {
          items.push(it);
        }
      }
    } else {
      for (const it of turns as any[]) {
        if (it && typeof it === "object" && typeof (it as any).type === "string") {
          items.push(it as Record<string, unknown>);
        }
      }
    }

    for (const item of items) {
      try {
        const id = (item.id as string) || `item-${Date.now()}-${Math.random()}`;
        const type = item.type as string;

        switch (type) {
          case "userMessage": {
            const text = this.#textFromContent((item as any).content) || "";
            messages.push({ id, role: "user", text, threadId });
            break;
          }

          case "agentMessage": {
            const agentText = ((item.text as string) || "").replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/g, "").trim();
            if (agentText) {
              messages.push({
                id,
                role: "assistant",
                text: agentText,
                threadId,
              });
            }
            break;
          }

          case "reasoning": {
            const text = this.#extractReasoningSummary(this.#reasoningTextFromItem(item));
            if (text) messages.push({ id, role: "assistant", kind: "reasoning", text, threadId });
            break;
          }

          case "commandExecution": {
            const command = (item.command as string) || "";
            const output = (item.aggregatedOutput as string) || "";
            const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
            messages.push({
              id,
              role: "tool",
              kind: "command",
              text: command ? `$ ${command}\n${output}` : output,
              threadId,
              metadata: exitCode !== null ? { exitCode } : undefined,
            });
            break;
          }

          case "fileChange": {
            const changes = item.changes as Array<{ path: string; diff?: string }>;
            messages.push({
              id,
              role: "tool",
              kind: "file",
              text: changes?.map((c) => `${c.path}\n${c.diff || ""}`).join("\n\n") || "",
              threadId,
            });
            break;
          }

          case "mcpToolCall":
            messages.push({
              id,
              role: "tool",
              kind: "mcp",
              text: `Tool: ${item.tool}\n${JSON.stringify(item.error ?? item.result ?? "", null, 2)}`,
              threadId,
            });
            break;

          case "webSearch":
            messages.push({
              id,
              role: "tool",
              kind: "web",
              text: `Search: ${item.query}`,
              threadId,
            });
            break;

          case "imageView":
            messages.push({
              id,
              role: "tool",
              kind: "image",
              text: `Image: ${item.path ?? ""}`,
              threadId,
            });
            break;

          case "enteredReviewMode": {
            const review = (item.review as string) || "";
            messages.push({
              id,
              role: "tool",
              kind: "review",
              text: review ? `Review started: ${review}` : "Review started.",
              threadId,
            });
            break;
          }

          case "exitedReviewMode": {
            const review = (item.review as string) || "";
            messages.push({
              id,
              role: "tool",
              kind: "review",
              text: review || "Review complete.",
              threadId,
            });
            break;
          }

          case "plan": {
            const text = ((item.text as string) || "").replace(/<\/?proposed_plan>/g, "").trim();
            if (text) messages.push({ id, role: "tool", kind: "plan", text, threadId });
            break;
          }

          case "collabAgentToolCall": {
            const tool = (item.tool as string) || "spawnAgent";
            const receivers = (item.receiverThreadIds as string[]) || [];
            const prompt = (item.prompt as string) || "";
            const status = (item.status as string) || "completed";
            const lines = [`${tool}: ${receivers.join(", ") || "—"}`];
            if (prompt) lines.push(prompt);
            lines.push(`Status: ${status}`);
            messages.push({ id, role: "tool", kind: "collab", text: lines.join("\n"), threadId });
            break;
          }

          case "contextCompaction":
            messages.push({ id, role: "tool", kind: "compaction", text: "Context compacted", threadId });
            break;
        }
      } catch {
        // Skip malformed history items; don't blank the whole thread.
      }
    }

    // Mark plans as approved if a user message follows them
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].kind !== "plan") continue;
      const hasFollowUp = messages.slice(i + 1).some(
        (m) => m.role === "user" || (m.role === "assistant" && m.kind !== "reasoning"),
      );
      if (hasFollowUp) {
        messages[i] = { ...messages[i], planStatus: "approved" };
      }
    }

    // Preserve any pending approval or user-input messages that arrived
    // before the thread history loaded (e.g. replayed from orbit).
    // We read from #pendingLiveMessages (a plain Map, not a Svelte proxy)
    // to avoid timing issues with the reactive #byThread proxy.
    for (const [id, msg] of this.#pendingLiveMessages) {
      if (msg.threadId !== threadId) continue;
      if (!messages.some((m) => m.id === id)) {
        messages.push(msg);
      }
    }

    this.#byThread.set(threadId, messages);
    this.#byThread = new Map(this.#byThread);
  }
}

function getStore(): MessagesStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    const store = new MessagesStore();
    global[STORE_KEY] = store;
    socket.onMessage((msg) => store.handleMessage(msg));
  }
  return global[STORE_KEY] as MessagesStore;
}

export const messages = getStore();
