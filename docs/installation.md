# Installing Zane

Zane runs a local Anchor service on your Mac that connects to Orbit (the hosted control plane) so you can supervise Codex sessions remotely.

## Requirements

- macOS (Apple Silicon or Intel)
- [Bun](https://bun.sh) runtime
- [Codex CLI](https://github.com/openai/codex) installed

## Install

Run the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/z-siddiqi/zane/main/install.sh | bash
```

This clones the repo to `~/.zane`, installs Anchor dependencies, and adds `zane` to your PATH.

### Build from source

```bash
git clone https://github.com/z-siddiqi/zane.git ~/.zane
cd ~/.zane/services/anchor && bun install
```

Add `~/.zane/bin` to your PATH.

## Setup

1. Run `zane start` (or `zane login` to re-authenticate)
2. A device code is displayed in your terminal
3. A browser window opens to enter the code
4. Once authorised, credentials are saved to `~/.zane/credentials.json`

## Running

Start Anchor:
```bash
zane start
```

Anchor connects to Orbit and waits for commands from the web client. Open the Zane web app in your browser to start supervising sessions.

## CLI Commands

| Command | Description |
|---------|-------------|
| `zane start` | Start the anchor service |
| `zane login` | Re-authenticate with the web app |
| `zane doctor` | Check prerequisites and configuration |
| `zane config` | Open `.env` in your editor |
| `zane update` | Pull latest code and reinstall dependencies |
| `zane self-host` | Run the self-host setup wizard |
| `zane uninstall` | Remove Zane from your system |
| `zane version` | Print version |
| `zane help` | Show help |

## Verify

Check that everything is configured correctly:
```bash
zane doctor
```

This checks for Bun, Codex CLI, Anchor source, dependencies, `.env` configuration, credentials, and whether Anchor is running.

## Updating

```bash
zane update
```

This pulls the latest code and reinstalls Anchor dependencies.

## Self-hosting

To deploy the entire stack to your own Cloudflare account:

```bash
zane self-host
```

See the [self-hosting guide](self-hosting.md) for prerequisites and a full walkthrough.

## Troubleshooting

### "zane: command not found"
Make sure `~/.zane/bin` is in your PATH:
```bash
echo 'export PATH="$HOME/.zane/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Connection issues
Re-authenticate:
```bash
zane login
```

### Check configuration
```bash
zane doctor
```
