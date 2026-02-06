<script lang="ts">
    import type { Snippet } from "svelte";
    import { auth } from "../auth.svelte";
    import { route } from "../../router";

    const { children }: { children: Snippet } = $props();

    let username = $state("");
    let newUsername = $state("");
    let mode = $state<"login" | "register">("login");
</script>

{#if auth.status === "loading"}
    <div class="auth-shell stack">
        <div class="auth-card stack">
            <div class="auth-title">Checking session</div>
            <div class="auth-subtitle">Waiting for passkey status...</div>
        </div>
    </div>
{:else if auth.status === "signed_in" || route.pathname === "/"}
    {@render children()}
{:else if auth.status === "needs_setup"}
    <div class="auth-shell stack">
        <div class="auth-card stack">
            <div class="auth-title">Welcome to Zane</div>
            <div class="auth-subtitle">Create your account to get started.</div>

            {#if auth.error}
                <div class="auth-error">{auth.error}</div>
            {/if}

            <input
                type="text"
                class="auth-input"
                placeholder="Username"
                bind:value={newUsername}
                onkeydown={(e) => { if (e.key === "Enter" && newUsername.trim()) auth.register(newUsername.trim()); }}
            />
            <button
                type="button"
                class="primary"
                onclick={() => auth.register(newUsername.trim())}
                disabled={auth.busy || !newUsername.trim()}
            >
                {auth.busy ? "Working..." : "Create passkey"}
            </button>
        </div>
    </div>
{:else}
    <div class="auth-shell stack">
        <div class="auth-card stack">
            {#if mode === "login"}
                <div class="auth-title">Sign in</div>
                <div class="auth-subtitle">Use your passkey to unlock Zane.</div>

                {#if auth.error}
                    <div class="auth-error">{auth.error}</div>
                {/if}

                <input
                    type="text"
                    class="auth-input"
                    placeholder="Username"
                    bind:value={username}
                    onkeydown={(e) => { if (e.key === "Enter" && username.trim()) auth.signIn(username.trim()); }}
                />
                <button
                    type="button"
                    class="primary"
                    onclick={() => auth.signIn(username.trim())}
                    disabled={auth.busy || !username.trim()}
                >
                    {auth.busy ? "Working..." : "Sign in with passkey"}
                </button>
                <button type="button" class="link" onclick={() => { mode = "register"; auth.error = null; }}>
                    Create new account
                </button>
            {:else}
                <div class="auth-title">Create account</div>
                <div class="auth-subtitle">Register a new account with a passkey.</div>

                {#if auth.error}
                    <div class="auth-error">{auth.error}</div>
                {/if}

                <input
                    type="text"
                    class="auth-input"
                    placeholder="Username"
                    bind:value={newUsername}
                    onkeydown={(e) => { if (e.key === "Enter" && newUsername.trim()) auth.register(newUsername.trim()); }}
                />
                <button
                    type="button"
                    class="primary"
                    onclick={() => auth.register(newUsername.trim())}
                    disabled={auth.busy || !newUsername.trim()}
                >
                    {auth.busy ? "Working..." : "Create passkey"}
                </button>
                <button type="button" class="link" onclick={() => { mode = "login"; auth.error = null; }}>
                    Back to sign in
                </button>
            {/if}
        </div>
    </div>
{/if}

<style>
    .auth-shell {
        min-height: 100vh;
        background: var(--cli-bg);
        color: var(--cli-text);
        font-family: var(--font-mono);
        align-items: center;
        padding: var(--space-xl) var(--space-md);
        --stack-gap: 0;
    }

    .auth-card {
        width: 100%;
        max-width: var(--app-max-width);
        padding: var(--space-md);
        --stack-gap: var(--space-md);
    }

    .auth-title {
        font-size: var(--text-lg);
        font-weight: 600;
    }

    .auth-subtitle {
        color: var(--cli-text-dim);
        font-size: var(--text-sm);
    }

    .auth-input {
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        border: 1px solid var(--cli-border);
        background: var(--cli-bg);
        color: var(--cli-text);
        font-family: var(--font-mono);
        outline: none;
    }

    .auth-input:focus {
        border-color: var(--cli-text-dim);
    }

    .auth-error {
        padding: var(--space-sm);
        border-radius: var(--radius-sm);
        background: var(--color-btn-danger-bg);
        color: var(--color-btn-danger-text);
        font-size: var(--text-sm);
    }

    button.primary {
        align-self: flex-start;
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-sm);
        border: 1px solid var(--cli-border);
        background: var(--color-btn-primary-bg);
        color: var(--color-btn-primary-text);
        font-family: var(--font-mono);
        cursor: pointer;
    }

    button.link {
        align-self: flex-start;
        padding: 0;
        border: none;
        background: none;
        color: var(--cli-text-dim);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        cursor: pointer;
        text-decoration: underline;
    }

    button.link:hover {
        color: var(--cli-text);
    }

    button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
</style>
