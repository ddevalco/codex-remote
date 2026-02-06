import type { ApprovalPolicy, CollaborationMode, CollaborationModeMask, ModeKind, ReasoningEffort, SandboxMode, ThreadInfo, RpcMessage, ThreadSettings } from "./types";
import { socket } from "./socket.svelte";
import { messages } from "./messages.svelte";
import { navigate } from "../router";

const STORE_KEY = "__zane_threads_store__";
const SETTINGS_STORAGE_KEY = "zane_thread_settings";

const DEFAULT_SETTINGS: ThreadSettings = {
  model: "",
  reasoningEffort: "medium",
  sandbox: "workspace-write",
  mode: "code",
};

class ThreadsStore {
  list = $state<ThreadInfo[]>([]);
  currentId = $state<string | null>(null);
  loading = $state(false);

  #settings = $state<Map<string, ThreadSettings>>(new Map());
  #nextId = 1;
  #pendingRequests = new Map<number, string>();
  #pendingStartInput: string | null = null;
  #pendingCollaborationMode: CollaborationMode | null = null;
  #pendingStartCallback: ((threadId: string) => void) | null = null;
  #suppressNextNavigation = false;
  #collaborationPresets: CollaborationModeMask[] = [];

  constructor() {
    this.#loadSettings();
  }

  getSettings(threadId: string | null): ThreadSettings {
    if (!threadId) return { ...DEFAULT_SETTINGS };
    const settings = this.#settings.get(threadId);
    return settings ? { ...settings } : { ...DEFAULT_SETTINGS };
  }

  updateSettings(threadId: string, update: Partial<ThreadSettings>) {
    const current = this.#settings.get(threadId) ?? DEFAULT_SETTINGS;
    const next: ThreadSettings = { ...current, ...update };
    if (
      current.model === next.model &&
      current.reasoningEffort === next.reasoningEffort &&
      current.sandbox === next.sandbox &&
      current.mode === next.mode
    ) {
      return;
    }
    this.#settings = new Map(this.#settings).set(threadId, next);
    this.#saveSettings();
  }

  fetch() {
    const id = this.#nextId++;
    this.loading = true;
    this.#pendingRequests.set(id, "list");
    socket.send({
      method: "thread/list",
      id,
      params: { cursor: null, limit: 50 },
    });
  }

  open(threadId: string) {
    const id = this.#nextId++;
    this.loading = true;
    this.currentId = threadId;
    messages.clearThread(threadId);
    socket.subscribeThread(threadId);
    this.#pendingRequests.set(id, "resume");
    socket.send({
      method: "thread/resume",
      id,
      params: { threadId },
    });
  }

  start(
    cwd: string,
    input?: string,
    options?: {
      approvalPolicy?: ApprovalPolicy | string;
      sandbox?: SandboxMode | string;
      suppressNavigation?: boolean;
      onThreadStarted?: (threadId: string) => void;
      collaborationMode?: CollaborationMode;
    }
  ) {
    this.#startThread(cwd, input, options);
  }

  fetchCollaborationPresets() {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "collaborationPresets");
    socket.send({
      method: "collaborationMode/list",
      id,
      params: {},
    });
  }

  resolveCollaborationMode(
    mode: ModeKind,
    model: string,
    reasoningEffort?: ReasoningEffort,
  ): CollaborationMode {
    const preset = this.#collaborationPresets.find((p) => p.mode === mode);
    return {
      mode,
      settings: {
        model,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(preset?.developer_instructions
          ? { developer_instructions: preset.developer_instructions }
          : {}),
      },
    };
  }

  archive(threadId: string) {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "archive");
    socket.unsubscribeThread(threadId);
    socket.send({
      method: "thread/archive",
      id,
      params: { threadId },
    });
    this.list = this.list.filter((t) => t.id !== threadId);
    if (this.currentId === threadId) {
      this.currentId = null;
    }
    if (this.#settings.has(threadId)) {
      const next = new Map(this.#settings);
      next.delete(threadId);
      this.#settings = next;
      this.#saveSettings();
    }
  }

  handleMessage(msg: RpcMessage) {
    if (msg.method === "thread/started") {
      const params = msg.params as { thread: ThreadInfo };
      if (params?.thread) {
        socket.subscribeThread(params.thread.id);
        this.#handleNewThread(params.thread);
      }
      return;
    }

    if (msg.id && this.#pendingRequests.has(msg.id as number)) {
      const type = this.#pendingRequests.get(msg.id as number);
      this.#pendingRequests.delete(msg.id as number);

      if (type === "list" && msg.result) {
        const result = msg.result as { data: ThreadInfo[] };
        this.list = result.data || [];
        this.loading = false;
      }

      if (type === "resume") {
        this.loading = false;
      }

      if (type === "collaborationPresets" && msg.result) {
        const result = msg.result as { data: CollaborationModeMask[] };
        this.#collaborationPresets = result.data || [];
      }

      if (type === "start" && msg.result) {
        const result = msg.result as {
          thread?: ThreadInfo;
          model?: string;
          reasoningEffort?: ReasoningEffort;
          sandbox?: { type?: string } | string;
        };
        const thread = result.thread;
        if (thread?.id) {
          const sandbox = this.#normalizeSandbox(result.sandbox);
          this.updateSettings(thread.id, {
            model: result.model ?? "",
            reasoningEffort: result.reasoningEffort ?? DEFAULT_SETTINGS.reasoningEffort,
            ...(sandbox ? { sandbox } : {}),
          });

          // Handle thread creation if thread/started notification hasn't arrived
          if (!this.list.some((t) => t.id === thread.id)) {
            socket.subscribeThread(thread.id);
            this.#handleNewThread(thread);
          }
        }
      }
    }
  }

  #handleNewThread(thread: ThreadInfo) {
    if (this.list.some((t) => t.id === thread.id)) return;
    this.list = [thread, ...this.list];
    this.currentId = thread.id;
    if (this.#pendingStartCallback) {
      this.#pendingStartCallback(thread.id);
      this.#pendingStartCallback = null;
    }
    if (!this.#suppressNextNavigation) {
      navigate("/thread/:id", { params: { id: thread.id } });
    }
    if (this.#pendingStartInput) {
      socket.send({
        method: "turn/start",
        id: this.#nextId++,
        params: {
          threadId: thread.id,
          input: [{ type: "text", text: this.#pendingStartInput }],
          ...(this.#pendingCollaborationMode
            ? { collaborationMode: this.#pendingCollaborationMode }
            : {}),
        },
      });
      this.#pendingStartInput = null;
      this.#pendingCollaborationMode = null;
    }
    this.#suppressNextNavigation = false;
  }

  #normalizeSandbox(input: unknown): SandboxMode | null {
    if (!input) return null;
    if (typeof input === "string") {
      if (input === "read-only" || input === "workspace-write" || input === "danger-full-access") {
        return input;
      }
      const lower = input.toLowerCase();
      if (lower.includes("readonly")) return "read-only";
      if (lower.includes("workspace")) return "workspace-write";
      if (lower.includes("danger") || lower.includes("full")) return "danger-full-access";
      return null;
    }
    if (typeof input === "object") {
      const type = (input as { type?: string }).type;
      if (!type) return null;
      if (type === "readOnly") return "read-only";
      if (type === "workspaceWrite") return "workspace-write";
      if (type === "dangerFullAccess") return "danger-full-access";
      return this.#normalizeSandbox(type);
    }
    return null;
  }

  #startThread(
    cwd: string,
    input: string | undefined,
    options?: {
      approvalPolicy?: ApprovalPolicy | string;
      sandbox?: SandboxMode | string;
      suppressNavigation?: boolean;
      onThreadStarted?: (threadId: string) => void;
      collaborationMode?: CollaborationMode;
    }
  ) {
    const id = this.#nextId++;
    this.#pendingRequests.set(id, "start");
    this.#pendingStartInput = input?.trim() ? input.trim() : null;
    this.#pendingCollaborationMode = options?.collaborationMode ?? null;
    this.#pendingStartCallback = options?.onThreadStarted ?? null;
    this.#suppressNextNavigation = options?.suppressNavigation ?? false;
    socket.send({
      method: "thread/start",
      id,
      params: {
        cwd,
        ...(options?.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
        ...(options?.sandbox ? { sandbox: options.sandbox } : {}),
      },
    });
  }

  #loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved) as Record<string, ThreadSettings>;
      const next = new Map<string, ThreadSettings>();
      for (const [threadId, settings] of Object.entries(data)) {
        if (!threadId) continue;
        next.set(threadId, { ...DEFAULT_SETTINGS, ...settings });
      }
      this.#settings = next;
    } catch {
      // ignore
    }
  }

  #saveSettings() {
    try {
      const data: Record<string, ThreadSettings> = {};
      for (const [threadId, settings] of this.#settings) {
        data[threadId] = settings;
      }
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }
}

function getStore(): ThreadsStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    const store = new ThreadsStore();
    global[STORE_KEY] = store;
    socket.onMessage((msg) => store.handleMessage(msg));
  }
  return global[STORE_KEY] as ThreadsStore;
}

export const threads = getStore();
