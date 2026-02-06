# Event Reference

This document covers every JSON-RPC method the web client sends and receives
via Anchor/Orbit. The wire format is JSON-RPC 2.0-like over WebSocket.

## Client → Server

### Thread Management

| Method | Params | Notes |
|---|---|---|
| `thread/start` | `{ cwd, approvalPolicy?, sandbox? }` | Creates a new thread |
| `thread/list` | `{ cursor, limit }` | Paginated list |
| `thread/resume` | `{ threadId }` | Rehydrate a thread (returns turns + items) |
| `thread/archive` | `{ threadId }` | Soft-delete |

### Turn Control

| Method | Params | Notes |
|---|---|---|
| `turn/start` | `{ threadId, input, collaborationMode?, model?, effort?, sandboxPolicy? }` | Start a turn. `input` is `[{ type: "text", text }]`. `collaborationMode` sets plan/code mode. |
| `turn/interrupt` | `{ threadId, turnId }` | Interrupt an in-progress turn. Returns `{}`, then `turn/completed` with status `"Interrupted"`. |

### Collaboration Mode

| Method | Params | Notes |
|---|---|---|
| `collaborationMode/list` | `{}` | Fetch available presets. Returns `{ data: CollaborationModeMask[] }`. |

`collaborationMode` on `turn/start`:

```json
{
  "collaborationMode": {
    "mode": "plan",
    "settings": {
      "model": "o3",
      "reasoning_effort": "medium",
      "developer_instructions": "..."
    }
  }
}
```

`mode` values: `"plan"`, `"code"`.

### Approval Responses

Sent as JSON-RPC responses (matching the request `id`):

```json
{ "id": <rpcId>, "result": { "decision": "<value>" } }
```

Decisions: `"accept"`, `"acceptForSession"`, `"decline"`, `"cancel"`.

### User Input Responses

Sent as JSON-RPC responses to `item/tool/requestUserInput`:

```json
{ "id": <rpcId>, "result": { "answers": { "<questionId>": { "answers": ["..."] } } } }
```

### Orbit Control Messages

These are not JSON-RPC — they are raw control frames handled by the Orbit DO.

| Type | Shape | Notes |
|---|---|---|
| `orbit.subscribe` | `{ type, threadId }` | Subscribe to events for a thread |
| `orbit.unsubscribe` | `{ type, threadId }` | Unsubscribe from a thread |

## Server → Client

### Thread Lifecycle

| Method | Params | Notes |
|---|---|---|
| `thread/started` | `{ thread: ThreadInfo }` | Notification after `thread/start` succeeds |
| `thread/list` response | `{ data: ThreadInfo[] }` | RPC response |
| `thread/resume` response | `{ thread: { id, turns: [{ items }] } }` | Full thread history for rehydration |

### Turn Lifecycle

| Method | Params | Notes |
|---|---|---|
| `turn/started` | `{ turn: { id, status } }` | Resets plan, reasoning, and status state |
| `turn/completed` | `{ turn: { id, status } }` | Status: `"Completed"`, `"Interrupted"`, `"Failed"` |
| `turn/plan/updated` | `{ turnId, explanation?, plan[] }` | Plan step progress. `plan[].status`: `"Pending"`, `"InProgress"`, `"Completed"` |
| `turn/diff/updated` | `{ threadId, turnId, diff }` | Cumulative workspace diff |

### Item Streaming (Notifications)

| Method | Params | Notes |
|---|---|---|
| `item/started` | `{ item }` | Item lifecycle start. Handled for `userMessage` and `commandExecution`. |
| `item/agentMessage/delta` | `{ threadId, itemId, delta }` | Streaming agent reply text |
| `item/reasoning/summaryTextDelta` | `{ threadId, delta }` | Reasoning summary chunk |
| `item/reasoning/textDelta` | `{ threadId, delta }` | Reasoning raw content (preferred over summary) |
| `item/reasoning/summaryPartAdded` | `{ threadId }` | Section break between reasoning parts |
| `item/commandExecution/outputDelta` | `{ threadId, itemId, delta }` | Streaming command stdout/stderr |
| `item/fileChange/outputDelta` | `{ threadId, itemId, delta }` | Streaming file diff output |
| `item/commandExecution/terminalInteraction` | `{ threadId, itemId, processId?, stdin }` | Interactive command. Empty `stdin` = waiting state. |
| `item/mcpToolCall/progress` | `{ threadId, itemId, message }` | MCP tool progress messages |
| `item/plan/delta` | `{ threadId, itemId, delta }` | Streaming plan text (plan mode) |
| `item/completed` | `{ item }` | Final item state (see Item Types below) |

### Approval Requests (JSON-RPC Requests)

These are JSON-RPC **requests** from server to client. The client must respond
with a decision.

| Method | Params |
|---|---|
| `item/commandExecution/requestApproval` | `{ threadId, itemId, reason? }` |
| `item/fileChange/requestApproval` | `{ threadId, itemId, reason? }` |
| `item/mcpToolCall/requestApproval` | `{ threadId, itemId, reason? }` |

### User Input Requests (JSON-RPC Requests)

| Method | Params |
|---|---|
| `item/tool/requestUserInput` | `{ threadId, itemId, questions[] }` |

Each question: `{ id, header, question, isOther?, isSecret?, options?: [{ label, description }] }`.

## Item Types on `item/completed`

| Type | Shape | MessageKind |
|---|---|---|
| `userMessage` | `{ content: [{ type: "text", text }] }` | (user role) |
| `agentMessage` | `{ text }` | (assistant role) |
| `reasoning` | `{ summary: string[], content: string[] }` | `"reasoning"` |
| `commandExecution` | `{ command, aggregatedOutput, exitCode }` | `"command"` |
| `fileChange` | `{ changes: [{ path, diff? }] }` | `"file"` |
| `mcpToolCall` | `{ tool, result?, error? }` | `"mcp"` |
| `webSearch` | `{ query }` | `"web"` |
| `imageView` | `{ path }` | `"image"` |
| `enteredReviewMode` | `{ review }` | `"review"` |
| `exitedReviewMode` | `{ review }` | `"review"` |
| `plan` | `{ text }` | `"plan"` |
| `collabAgentToolCall` | `{ tool, status, receiverThreadIds, prompt }` | `"collab"` |
| `contextCompaction` | `{}` | `"compaction"` |

## Client Rendering Notes

- **Reasoning** deltas are buffered, not streamed into the transcript. The first
  `**bold**` chunk is extracted as the live "Working" detail. On `item/completed`,
  a single collapsed reasoning block is emitted.
- **Terminal interactions** with empty `stdin` show a shimmer "waiting" block.
  Once input arrives the wait block is removed and stdin is appended to the
  terminal transcript.
- **Agent messages** strip `<proposed_plan>` tags before rendering (plan text is
  delivered separately via the `plan` item type).
- **Plan items** render as `PlanCard` components with an "Approve" action. On
  approval the client sends a follow-up `turn/start` in code mode.
- **Context compaction** renders as a subtle centered `↕ Context compacted`
  divider (not a collapsible tool block).
- **Collaboration mode** auto-syncs to `"plan"` when an unapproved plan item
  exists, and resets to `"code"` when the user approves or manually toggles.

## Event Persistence (Orbit)

Only a subset of events are persisted to D1 for reconnection/audit. All other
events are relayed in real-time but not stored.

**Stored events** (see `STORED_METHODS` in `services/orbit/src/index.ts`):
- `turn/start`
- `turn/started`
- `turn/diff/updated`
- `item/started`
