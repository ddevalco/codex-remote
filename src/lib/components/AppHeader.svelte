<script lang="ts">
    import type { Snippet } from "svelte";
    import type { ConnectionStatus, SandboxMode } from "../types";
    import { socket } from "../socket.svelte";
    import { connectionManager } from "../connection-manager.svelte";
    import { anchors } from "../anchors.svelte";
    import ShimmerDot from "./ShimmerDot.svelte";

    interface Props {
        status: ConnectionStatus;
        threadId?: string | null;
        sandbox?: SandboxMode;
        onSandboxChange?: (sandbox: SandboxMode) => void;
        actions?: Snippet;
    }

    const { status, threadId, sandbox, onSandboxChange, actions }: Props = $props();

    let sandboxOpen = $state(false);
    let mobileMenuOpen = $state(false);

    const statusConfig: Record<ConnectionStatus, { icon: string; color: string; label: string }> = {
        connected: { icon: "●", color: "var(--cli-success)", label: "connected" },
        connecting: { icon: "○", color: "var(--cli-text-dim)", label: "connecting" },
        reconnecting: { icon: "◐", color: "var(--cli-warning)", label: "reconnecting" },
        disconnected: { icon: "○", color: "var(--cli-text-dim)", label: "disconnected" },
        error: { icon: "✗", color: "var(--cli-error)", label: "error" },
    };

    const sandboxOptions: { value: SandboxMode; label: string }[] = [
        { value: "read-only", label: "Read Only" },
        { value: "workspace-write", label: "Workspace" },
        { value: "danger-full-access", label: "Full Access" },
    ];

    const statusMeta = $derived(statusConfig[status]);
    const selectedSandbox = $derived(sandboxOptions.find((s) => s.value === sandbox) || sandboxOptions[1]);
    const canReconnect = $derived(status === "error" || status === "disconnected");
    const showAnchorAlert = $derived(status === "connected" && anchors.status === "none");

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest(".sandbox-dropdown")) {
            sandboxOpen = false;
        }
        if (!target.closest(".mobile-menu") && !target.closest(".hamburger-btn")) {
            mobileMenuOpen = false;
        }
    }

    function handleStatusClick() {
        if (canReconnect) {
            connectionManager.requestConnect();
        }
    }

    function getStatusTitle(): string {
        if (status === "connected") return "Connected";
        if (status === "connecting") return "Connecting...";
        if (status === "reconnecting") return "Reconnecting...";
        if (status === "error" && socket.error) return `Error: ${socket.error}. Click to reconnect`;
        if (status === "disconnected") return "Disconnected. Click to connect";
        return "Connection status";
    }
</script>

<svelte:window onclick={handleClickOutside} />

<header class="app-header">
    <div class="app-header-inner row">
        <a href="/app" class="brand">zane</a>
        <span class="separator">·</span>
        <button
            type="button"
            class="status-btn row"
            class:clickable={canReconnect}
            onclick={handleStatusClick}
            title={getStatusTitle()}
            disabled={!canReconnect}
        >
            {#if status === "connecting" || status === "reconnecting"}
                <ShimmerDot color={statusMeta.color} />
            {:else}
                <span class="status-icon" style:color={statusMeta.color}>{statusMeta.icon}</span>
            {/if}
        </button>

        {#if threadId}
            <span class="separator">·</span>
            <span class="thread-id">{threadId.slice(0, 8)}</span>
        {/if}

        {#if showAnchorAlert}
            <span class="separator">·</span>
            <span class="anchor-alert">No device connected</span>
        {/if}

        {#if sandbox && onSandboxChange}
            <span class="separator">·</span>
            <div class="sandbox-dropdown" class:open={sandboxOpen}>
                <button
                    type="button"
                    class="sandbox-btn row"
                    class:danger={sandbox === "danger-full-access"}
                    onclick={(e) => {
                        e.stopPropagation();
                        sandboxOpen = !sandboxOpen;
                    }}
                >
                    <svg class="shield-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                    </svg>
                    <span class="sandbox-label">{selectedSandbox.label}</span>
                    <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </button>
                {#if sandboxOpen}
                    <div class="sandbox-menu">
                        {#each sandboxOptions as option}
                            <button
                                type="button"
                                class="sandbox-item split"
                                class:selected={sandbox === option.value}
                                class:danger={option.value === "danger-full-access"}
                                onclick={() => {
                                    onSandboxChange(option.value);
                                    sandboxOpen = false;
                                }}
                            >
                                <span>{option.label}</span>
                                {#if sandbox === option.value}
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                {/if}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}

        <div class="spacer"></div>

        {#if actions}
            <div class="desktop-actions row">
                {@render actions()}
            </div>

            <button
                type="button"
                class="hamburger-btn row"
                onclick={(e) => {
                    e.stopPropagation();
                    mobileMenuOpen = !mobileMenuOpen;
                }}
                aria-label="Menu"
                aria-expanded={mobileMenuOpen}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    {#if mobileMenuOpen}
                        <path d="M18 6 6 18M6 6l12 12" />
                    {:else}
                        <path d="M3 12h18M3 6h18M3 18h18" />
                    {/if}
                </svg>
            </button>
        {/if}
    </div>

    {#if mobileMenuOpen && actions}
        <nav class="mobile-menu stack">
            {@render actions()}
        </nav>
    {/if}
</header>

<style>
    .app-header {
        position: relative;
        width: 100vw;
        margin-left: calc(50% - 50vw);
        background: var(--cli-bg-elevated);
        border-bottom: 1px solid var(--cli-border);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        color: var(--cli-text);
    }

    .app-header-inner {
        --row-gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        max-width: var(--app-max-width);
        margin: 0 auto;
    }

    .brand {
        font-weight: 600;
        color: var(--cli-prefix-agent);
        text-decoration: none;
        transition: opacity var(--transition-fast);
    }

    .brand:hover {
        opacity: 0.8;
    }

    .separator {
        color: var(--cli-text-muted);
    }

    .status-icon {
        line-height: 1;
    }

    .status-btn {
        --row-gap: 0;
        padding: 0;
        background: transparent;
        border: none;
        cursor: default;
    }

    .status-btn.clickable {
        cursor: pointer;
    }

    .anchor-alert {
        padding: 0 var(--space-xs);
        border-radius: var(--radius-sm);
        border: 1px solid var(--cli-warning);
        color: var(--cli-warning);
        font-size: var(--text-xs);
        line-height: 1.4;
    }

    .thread-id {
        color: var(--cli-text-dim);
        font-size: var(--text-xs);
    }

    .spacer {
        flex: 1;
    }

    /* Sandbox dropdown */
    .sandbox-dropdown {
        position: relative;
    }

    .sandbox-btn {
        --row-gap: var(--space-xs);
        padding: var(--space-xs) var(--space-sm);
        background: transparent;
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-sm);
        color: var(--cli-text-dim);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .sandbox-btn .sandbox-label,
    .sandbox-btn .chevron {
        display: none;
    }

    @media (min-width: 640px) {
        .sandbox-btn .sandbox-label,
        .sandbox-btn .chevron {
            display: block;
        }
    }

    .sandbox-btn:hover {
        background: var(--cli-selection);
        color: var(--cli-text);
        border-color: var(--cli-text-muted);
    }

    .sandbox-btn.danger {
        color: var(--cli-error);
        border-color: var(--cli-error);
    }

    .sandbox-btn.danger:hover {
        background: var(--cli-error-bg);
    }

    .shield-icon {
        width: 0.875rem;
        height: 0.875rem;
    }

    .sandbox-btn .chevron {
        width: 0.625rem;
        height: 0.625rem;
        opacity: 0.5;
        flex-shrink: 0;
    }

    .sandbox-menu {
        position: absolute;
        top: 100%;
        left: 0;
        min-width: 140px;
        margin-top: var(--space-xs);
        padding: var(--space-xs);
        background: var(--cli-bg-elevated);
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-popover);
        z-index: 100;
        animation: fadeIn 0.1s ease;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .sandbox-item {
        --split-gap: var(--space-sm);
        width: 100%;
        padding: var(--space-sm);
        background: transparent;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--cli-text);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        text-align: left;
        cursor: pointer;
        transition: background var(--transition-fast);
    }

    .sandbox-item:hover {
        background: var(--cli-bg-hover);
    }

    .sandbox-item.selected {
        color: var(--cli-prefix-agent);
    }

    .sandbox-item.danger {
        color: var(--cli-error);
    }

    .sandbox-item svg {
        width: 0.875rem;
        height: 0.875rem;
    }

    /* Desktop actions */
    .desktop-actions {
        display: none;
        --row-gap: var(--space-sm);
    }

    @media (min-width: 640px) {
        .desktop-actions {
            display: flex;
        }
    }

    /* Global styles for action items passed via snippet */
    .desktop-actions :global(a),
    .desktop-actions :global(button) {
        padding: var(--space-xs) var(--space-sm);
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--cli-text-dim);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        text-decoration: none;
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .desktop-actions :global(a:hover),
    .desktop-actions :global(button:hover) {
        background: var(--cli-selection);
        color: var(--cli-text);
        border-color: var(--cli-text-muted);
    }

    /* Hamburger button */
    .hamburger-btn {
        justify-content: center;
        width: 2rem;
        height: 2rem;
        padding: 0;
        background: transparent;
        border: 1px solid var(--cli-border);
        border-radius: var(--radius-sm);
        color: var(--cli-text-dim);
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .hamburger-btn:hover {
        background: var(--cli-selection);
        color: var(--cli-text);
        border-color: var(--cli-text-muted);
    }

    .hamburger-btn svg {
        width: 1rem;
        height: 1rem;
    }

    @media (min-width: 640px) {
        .hamburger-btn {
            display: none;
        }
    }

    /* Mobile menu */
    .mobile-menu {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--cli-bg-elevated);
        border-bottom: 1px solid var(--cli-border);
        z-index: 100;
        animation: slideDown 0.15s ease;
        --stack-gap: 0;
    }

    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .mobile-menu :global(a),
    .mobile-menu :global(button) {
        display: block;
        width: 100%;
        padding: var(--space-md);
        background: transparent;
        border: none;
        border-top: 1px solid var(--cli-border);
        border-radius: 0;
        color: var(--cli-text);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        text-decoration: none;
        text-align: left;
        cursor: pointer;
        transition: background var(--transition-fast);
    }

    .mobile-menu :global(a:first-child),
    .mobile-menu :global(button:first-child) {
        border-top: none;
    }

    .mobile-menu :global(a:hover),
    .mobile-menu :global(button:hover) {
        background: var(--cli-selection);
    }

    @media (min-width: 640px) {
        .mobile-menu {
            display: none;
        }
    }
</style>
