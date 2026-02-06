<script lang="ts">
    import { route } from "../router";
    import { config } from "../lib/config.svelte";
    import { auth } from "../lib/auth.svelte";
    import { socket } from "../lib/socket.svelte";
    import { theme } from "../lib/theme.svelte";
    import AppHeader from "../lib/components/AppHeader.svelte";
    import PierreDiff from "../lib/components/PierreDiff.svelte";

    const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

    interface RpcMessage {
        id?: string | number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: unknown;
    }

    interface EventEntry {
        ts: string;
        direction: "client" | "server";
        message: RpcMessage;
    }

    type TurnItemType = "agent" | "command" | "file" | "approval" | "user-input" | "mcp";

    interface TurnItem {
        type: TurnItemType;
        text: string;
        ts: string;
        meta?: Record<string, unknown>;
    }

    interface TurnBlock {
        id: string;
        turnKey: string;
        cause: string | null;
        items: TurnItem[];
        diff: string | null;
        diffFiles: string[];
        ts: string;
        status?: string;
    }

    const threadId = $derived(route.params.id);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let turns = $state<TurnBlock[]>([]);

    function baseUrlFromWs(wsUrl: string): string | null {
        try {
            const url = new URL(wsUrl);
            url.protocol = url.protocol === "wss:" ? "https:" : "http:";
            url.pathname = "/";
            url.search = "";
            url.hash = "";
            return url.toString().replace(/\/$/, "");
        } catch {
            return null;
        }
    }

    function parseEvents(text: string): EventEntry[] {
        const events: EventEntry[] = [];
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as EventEntry;
                if (entry?.message && entry.ts) {
                    events.push(entry);
                }
            } catch {
                // ignore malformed lines
            }
        }
        return events;
    }

    function filesFromPatch(patch: string): string[] {
        const files = new Set<string>();
        const lines = patch.split(/\r?\n/);

        for (const line of lines) {
            const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            if (gitMatch) {
                const name = (gitMatch[2] || gitMatch[1]).replace(/^\"|\"$/g, "");
                if (name !== "/dev/null") files.add(name);
                continue;
            }
            const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
            if (plusMatch) {
                const name = plusMatch[1].replace(/^\"|\"$/g, "");
                if (name !== "/dev/null") files.add(name);
                continue;
            }
            const minusMatch = line.match(/^--- a\/(.+)$/);
            if (minusMatch) {
                const name = minusMatch[1].replace(/^\"|\"$/g, "");
                if (name !== "/dev/null") files.add(name);
            }
        }

        return Array.from(files);
    }

    function diffStats(text: string): { added: number; removed: number } {
        let added = 0;
        let removed = 0;
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
            if (line.startsWith("+")) added += 1;
            if (line.startsWith("-")) removed += 1;
        }
        return { added, removed };
    }

    function truncate(text: string, max = 140): string {
        const trimmed = text.trim();
        if (trimmed.length <= max) return trimmed;
        return `${trimmed.slice(0, max - 1)}…`;
    }

    function extractTurnInputText(params: Record<string, unknown> | undefined): string | null {
        const input = params?.input as Array<{ type?: string; text?: string }> | undefined;
        const text = input?.find((chunk) => chunk.type === "text")?.text;
        return text?.trim() ? text : null;
    }

    function resolveTurnKey(
        params: Record<string, unknown> | undefined,
        turnKeyByServerId: Map<string, string>,
        activeTurnKey: string,
    ): string {
        const serverTurnId =
            (params?.turnId as string | undefined) ?? (params?.turn_id as string | undefined);
        return serverTurnId
            ? (turnKeyByServerId.get(serverTurnId) ?? activeTurnKey)
            : activeTurnKey;
    }

    interface PendingRequest {
        turnKey: string;
        type: "approval" | "user-input";
        questions?: Array<{ id: string; question: string }>;
    }

    function buildTurns(events: EventEntry[]): TurnBlock[] {
        const turnCauseByKey = new Map<string, string>();
        const turnDiffByKey = new Map<string, { diff: string; ts: string }>();
        const turnItemsByKey = new Map<string, TurnItem[]>();
        const turnStatusByKey = new Map<string, string>();
        const turnTsByKey = new Map<string, string>();
        const turnKeyByServerId = new Map<string, string>();
        const turnOrder: string[] = [];
        const pendingRpcIds = new Map<number | string, PendingRequest>();
        let turnCounter = -1;
        let activeTurnKey = "0";

        function ensureTurn(key: string, ts: string) {
            if (!turnTsByKey.has(key)) {
                turnTsByKey.set(key, ts);
                turnOrder.push(key);
            }
        }

        function addItem(turnKey: string, item: TurnItem) {
            const items = turnItemsByKey.get(turnKey) ?? [];
            items.push(item);
            turnItemsByKey.set(turnKey, items);
        }

        for (const entry of events) {
            const message = entry.message;
            const method = message?.method;
            const params = message.params as Record<string, unknown> | undefined;

            if (method === "turn/start") {
                const text = extractTurnInputText(params);
                turnCounter += 1;
                activeTurnKey = String(turnCounter);
                ensureTurn(activeTurnKey, entry.ts);
                if (text) {
                    turnCauseByKey.set(activeTurnKey, text);
                }
                continue;
            }

            if (method === "turn/started") {
                const turn = params?.turn as Record<string, unknown> | undefined;
                const serverTurnId =
                    (turn?.id as string | number | undefined)?.toString() ??
                    (params?.turnId as string | undefined) ??
                    (params?.turn_id as string | undefined);
                if (serverTurnId) {
                    if (turnCounter < 0) {
                        activeTurnKey = serverTurnId;
                        const numericId = Number(serverTurnId);
                        turnCounter = Number.isFinite(numericId) ? numericId : 0;
                        ensureTurn(activeTurnKey, entry.ts);
                    }
                    turnKeyByServerId.set(serverTurnId, activeTurnKey);
                }
                continue;
            }

            if (method === "turn/completed") {
                const turnKey = resolveTurnKey(params, turnKeyByServerId, activeTurnKey);
                const status = (params?.status as string) ?? "Completed";
                turnStatusByKey.set(turnKey, status);
                continue;
            }

            // Match client responses (no method, has id + result) to tracked requests
            if (!method && message.id != null && message.result != null) {
                const pending = pendingRpcIds.get(message.id as number | string);
                if (pending) {
                    pendingRpcIds.delete(message.id as number | string);
                    const result = message.result as Record<string, unknown>;

                    if (pending.type === "approval") {
                        const decision = (result.decision as string) || "unknown";
                        const label = decision === "accept" || decision === "acceptForSession"
                            ? "Approved" : decision === "decline" ? "Declined" : "Cancelled";
                        addItem(pending.turnKey, {
                            type: "approval",
                            text: label,
                            ts: entry.ts,
                            meta: { isResponse: true, decision },
                        });
                    } else if (pending.type === "user-input") {
                        const answers = result.answers as Record<string, { answers: string[] }> | undefined;
                        if (answers) {
                            const parts: string[] = [];
                            for (const [qId, a] of Object.entries(answers)) {
                                const q = pending.questions?.find((q) => q.id === qId);
                                parts.push(`${q?.question || qId}: ${a.answers.join(", ")}`);
                            }
                            addItem(pending.turnKey, {
                                type: "user-input",
                                text: parts.join("; ") || "Answered",
                                ts: entry.ts,
                                meta: { isAnswer: true },
                            });
                        }
                    }
                    continue;
                }
            }

            if (entry.direction !== "server") continue;

            if (method === "turn/diff/updated") {
                const diff = (params?.diff as string | undefined) ?? "";
                if (diff) {
                    const turnKey = resolveTurnKey(params, turnKeyByServerId, activeTurnKey);
                    turnDiffByKey.set(turnKey, { diff, ts: entry.ts });
                }
                continue;
            }

            if (method === "item/started") {
                const item = params?.item as Record<string, unknown> | undefined;
                const itemType = item?.type as string | undefined;
                if (itemType === "userMessage") {
                    const content = item?.content as Array<{ type: string; text?: string }> | undefined;
                    const text = content?.find((chunk) => chunk.type === "text")?.text;
                    const turnKey = resolveTurnKey(params, turnKeyByServerId, activeTurnKey);
                    if (text && !turnCauseByKey.has(turnKey)) {
                        turnCauseByKey.set(turnKey, text);
                    }
                }
                continue;
            }

            if (method === "item/completed") {
                const item = params?.item as Record<string, unknown> | undefined;
                if (!item) continue;
                const itemType = item.type as string | undefined;
                const turnKey = resolveTurnKey(params, turnKeyByServerId, activeTurnKey);

                if (itemType === "agentMessage") {
                    const text = ((item.text as string) || "").replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/g, "").trim();
                    if (text) {
                        addItem(turnKey, { type: "agent", text, ts: entry.ts });
                    }
                } else if (itemType === "commandExecution") {
                    const command = (item.command as string) || "";
                    const output = (item.aggregatedOutput as string) || "";
                    const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
                    addItem(turnKey, {
                        type: "command",
                        text: command,
                        ts: entry.ts,
                        meta: { output, exitCode },
                    });
                } else if (itemType === "fileChange") {
                    const changes = item.changes as Array<{ path: string }> | undefined;
                    const paths = changes?.map((c) => c.path) ?? [];
                    if (paths.length > 0) {
                        addItem(turnKey, {
                            type: "file",
                            text: paths.join(", "),
                            ts: entry.ts,
                            meta: { paths },
                        });
                    }
                } else if (itemType === "mcpToolCall") {
                    const tool = (item.tool as string) || "tool";
                    addItem(turnKey, {
                        type: "mcp",
                        text: tool,
                        ts: entry.ts,
                    });
                }
                continue;
            }

            if (method?.endsWith("/requestApproval")) {
                const reason = (params?.reason as string) || "Action requires approval";
                const turnKey = resolveTurnKey(params, turnKeyByServerId, activeTurnKey);
                let label = "Approval";
                if (method.includes("fileChange")) label = "File change approval";
                else if (method.includes("commandExecution")) label = "Command approval";
                else if (method.includes("mcpToolCall")) label = "Tool call approval";
                addItem(turnKey, {
                    type: "approval",
                    text: `${label}: ${reason}`,
                    ts: entry.ts,
                });
                if (message.id != null) {
                    pendingRpcIds.set(message.id as number | string, { turnKey, type: "approval" });
                }
                continue;
            }

            if (method === "item/tool/requestUserInput") {
                const questions = (params?.questions as Array<{ id: string; question: string }>) || [];
                const text = questions.map((q) => q.question).join("; ") || "Input requested";
                const turnKey = resolveTurnKey(params, turnKeyByServerId, activeTurnKey);
                addItem(turnKey, {
                    type: "user-input",
                    text,
                    ts: entry.ts,
                });
                if (message.id != null) {
                    pendingRpcIds.set(message.id as number | string, { turnKey, type: "user-input", questions });
                }
                continue;
            }
        }

        // Build turn blocks — include all turns that have any content
        const result: TurnBlock[] = [];
        for (const turnKey of turnOrder) {
            const items = turnItemsByKey.get(turnKey) ?? [];
            const diffData = turnDiffByKey.get(turnKey);
            const cause = turnCauseByKey.get(turnKey) ?? null;
            const status = turnStatusByKey.get(turnKey);

            if (items.length === 0 && !diffData && !cause) continue;

            result.push({
                id: `turn-${turnKey}`,
                turnKey,
                cause,
                items,
                diff: diffData?.diff ?? null,
                diffFiles: diffData ? filesFromPatch(diffData.diff) : [],
                ts: turnTsByKey.get(turnKey) ?? diffData?.ts ?? "",
                status,
            });
        }

        return result;
    }

    async function loadEvents() {
        if (!threadId) return;
        const base = baseUrlFromWs(config.url);
        if (!base) {
            error = "Invalid server URL.";
            return;
        }

        loading = true;
        error = null;
        turns = [];

        try {
            const headers: Record<string, string> = {};
            if (auth.token) {
                headers.authorization = `Bearer ${auth.token}`;
            }
            const response = await fetch(`${base}/threads/${threadId}/events`, { headers });
            if (!response.ok) {
                error = `Failed to load events (${response.status}).`;
                return;
            }
            const text = await response.text();
            const events = parseEvents(text);
            turns = buildTurns(events);
        } catch (err) {
            error = err instanceof Error ? err.message : "Failed to load events.";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        if (threadId) {
            loadEvents();
        }
    });
</script>

<div class="review-page stack">
    <AppHeader status={socket.status} threadId={threadId}>
        {#snippet actions()}
            <a href={`/thread/${threadId}`}>back</a>
            <a href="/settings">Settings</a>
            <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
                {themeIcons[theme.current]}
            </button>
        {/snippet}
    </AppHeader>

    <div class="review-body">
        {#if loading}
            <div class="state">Loading events…</div>
        {:else if error}
            <div class="state error">{error}</div>
        {:else if turns.length === 0}
            <div class="state">No activity found for this thread yet.</div>
        {:else}
            {#each turns as turn (turn.id)}
                {@const stats = turn.diff ? diffStats(turn.diff) : null}
                <details class="turn" open={turn === turns[turns.length - 1]}>
                    <summary class="turn-header split">
                        <span class="turn-label">{turn.cause ? truncate(turn.cause, 80) : `Turn ${turn.turnKey}`}</span>
                        <span class="turn-meta row">
                            {#if stats}
                                <span class="turn-stats">
                                    <span class="diff-added">+{stats.added}</span>
                                    <span class="diff-removed">-{stats.removed}</span>
                                </span>
                            {/if}
                            {#if turn.items.length > 0}
                                <span class="item-count">{turn.items.length} items</span>
                            {/if}
                            <span class="turn-toggle"></span>
                        </span>
                    </summary>
                    <div class="turn-content">
                        {#if turn.items.length > 0}
                            <div class="timeline">
                                {#each turn.items as item}
                                    <div class="timeline-item timeline-{item.type}">
                                        {#if item.type === "agent"}
                                            <span class="item-label">Agent</span>
                                            <span class="item-text">{truncate(item.text, 200)}</span>
                                        {:else if item.type === "command"}
                                            <span class="item-label">Command</span>
                                            <code class="item-command">$ {item.text}</code>
                                            {#if item.meta?.exitCode != null}
                                                <span class="item-exit" class:exit-error={item.meta.exitCode !== 0}>exit {item.meta.exitCode}</span>
                                            {/if}
                                        {:else if item.type === "file"}
                                            <span class="item-label">Files</span>
                                            <span class="item-text">{item.text}</span>
                                        {:else if item.type === "mcp"}
                                            <span class="item-label">Tool</span>
                                            <span class="item-text">{item.text}</span>
                                        {:else if item.type === "approval"}
                                            {#if item.meta?.isResponse}
                                                <span class="item-label decision-label">&rarr;</span>
                                                <span class="item-text decision-text">{item.text}</span>
                                            {:else}
                                                <span class="item-label approval-label">Approval</span>
                                                <span class="item-text">{item.text}</span>
                                            {/if}
                                        {:else if item.type === "user-input"}
                                            {#if item.meta?.isAnswer}
                                                <span class="item-label answer-label">&rarr;</span>
                                                <span class="item-text answer-text">{item.text}</span>
                                            {:else}
                                                <span class="item-label input-label">Input</span>
                                                <span class="item-text">{item.text}</span>
                                            {/if}
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                        {#if turn.diff}
                            <PierreDiff diff={turn.diff} />
                        {/if}
                    </div>
                </details>
            {/each}
        {/if}
    </div>
</div>

<style>
    .review-page {
        --stack-gap: 0;
        height: 100%;
        background: var(--cli-bg);
        color: var(--cli-text);
    }

    .review-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: var(--space-lg) var(--space-xl);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
    }

    .state {
        color: var(--cli-text-muted);
        padding: var(--space-md);
    }

    .state.error {
        color: var(--cli-error);
    }

    .turn {
        margin-bottom: var(--space-lg);
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-md);
        background: var(--cli-bg-elevated);
    }

    .turn-header {
        --split-gap: var(--space-sm);
        list-style: none;
        cursor: pointer;
        padding: var(--space-sm) var(--space-md);
        font-size: var(--text-xs);
        color: var(--cli-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        transition: all var(--transition-fast);
    }

    .turn-header::-webkit-details-marker {
        display: none;
    }

    .turn-header:hover {
        background: var(--cli-bg-hover);
        color: var(--cli-text);
    }

    .turn[open] .turn-header {
        border-bottom: 1px solid var(--cli-border);
    }

    .turn-label {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        text-transform: none;
        letter-spacing: 0;
    }

    .turn-meta {
        --row-gap: var(--space-sm);
        flex-shrink: 0;
    }

    .turn-stats {
        font-size: var(--text-xs);
        text-transform: none;
        letter-spacing: 0;
    }

    .item-count {
        font-size: var(--text-xs);
        text-transform: none;
        letter-spacing: 0;
        color: var(--cli-text-muted);
    }

    .turn-toggle {
        width: 1rem;
        text-align: center;
        color: var(--cli-text-muted);
    }

    .turn-toggle::before {
        content: "+";
    }

    .turn[open] .turn-toggle::before {
        content: "−";
    }

    .turn-content {
        background: var(--cli-bg);
    }

    .diff-added {
        color: var(--cli-success);
    }

    .diff-removed {
        color: var(--cli-error);
    }

    /* Timeline */
    .timeline {
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        border-bottom: 1px solid var(--cli-border);
    }

    .timeline-item {
        display: flex;
        align-items: baseline;
        gap: var(--space-sm);
        line-height: 1.5;
    }

    .item-label {
        flex-shrink: 0;
        font-size: var(--text-xs);
        color: var(--cli-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        min-width: 5rem;
    }

    .item-text {
        color: var(--cli-text-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .item-command {
        color: var(--cli-text);
    }

    .item-exit {
        flex-shrink: 0;
        font-size: var(--text-xs);
        color: var(--cli-text-muted);
    }

    .exit-error {
        color: var(--cli-error);
    }

    .approval-label {
        color: var(--cli-warning, #d4a72c);
    }

    .input-label {
        color: var(--cli-info, #5b9bd5);
    }

    .decision-label,
    .answer-label {
        min-width: 5rem;
        text-align: right;
        color: var(--cli-text-muted);
    }

    .decision-text {
        color: var(--cli-success, #6a9955);
    }

    .answer-text {
        color: var(--cli-text);
        white-space: pre-wrap;
        overflow: visible;
    }

    .timeline-agent .item-text {
        white-space: pre-wrap;
        overflow: visible;
    }

    @media (max-width: 900px) {
        .review-body {
            padding: var(--space-lg) var(--space-md);
        }
    }
</style>
