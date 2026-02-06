# Common Patterns

## Svelte 5 Store Pattern

```ts
class ExampleStore {
  value = $state(0);

  increment() {
    this.value += 1;
  }
}

function getStore(): ExampleStore {
  const global = globalThis as Record<string, unknown>;
  if (!global.__example_store__) {
    global.__example_store__ = new ExampleStore();
  }
  return global.__example_store__ as ExampleStore;
}

export const example = getStore();
```

## Derived State

```ts
const count = $state(0);
const doubled = $derived(count * 2);
```

## WebSocket Connect (client)

```ts
socket.connect(config.url, auth.token);
```

## Orbit Auth (Worker)

```ts
const provided = req.headers.get("authorization") ?? "";
```

## Anchor Initialize

```ts
const initPayload = {
  method: "initialize",
  params: {
    cwd: ANCHOR_APP_CWD,
    clientInfo: { name: "zane-anchor", version: "dev", platform: process.platform },
  },
};
```

## Auth Logout (client)

```ts
await fetch(apiUrl("/auth/logout"), { method: "POST", headers: authHeaders });
```
