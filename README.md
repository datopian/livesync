# LiveSync

Real-time collaboration on local files — Google Docs-style sync, but for files on your disk, in your editor.

LiveSync is a CLI tool that lets you collaboratively edit any text file in real-time without leaving your preferred editor. It watches a file on disk, syncs changes through a relay server using CRDTs, and writes incoming changes back. Vim, VS Code, Emacs, Sublime — if your editor can save to disk, it works.

**Status:** Alpha — open source, free, expect rough edges.

## Quick Start

### 1. Install

```bash
git clone https://github.com/nicokant/livesync.git
cd livesync
npm install
npm run build
```

To use the `livesync` command globally:

```bash
npm link
```

### 2. Share a file

```bash
livesync share notes.md
```

This connects to the public relay, creates a session, and starts watching your file. You'll see output like:

```
Sharing notes.md
Session: abc123

Others can join with:
  livesync join abc123
```

### 3. Join from another machine (or terminal)

```bash
livesync join abc123
```

This creates a local copy synced to the session. You can also specify a filename:

```bash
livesync join abc123 my-local-copy.md
```

Both files now stay in sync in real-time. Edit in your editor, save, and changes appear on the other side in under a second.

### 4. Stop

`Ctrl+C` to disconnect.

## How It Works

1. Your editor saves a file to disk
2. LiveSync detects the change, diffs it against its CRDT document (Yjs), and sends a minimal update to the relay
3. The relay broadcasts to all connected clients
4. Other clients apply the update to their local CRDT doc and write the result to disk
5. Their editor picks up the changed file

Concurrent edits merge cleanly thanks to CRDTs — no locking, no manual conflict resolution.

## CLI Reference

```
livesync share <filepath>              # Start sharing a file
  -r, --relay <url>                    # Custom relay URL (default: public relay)

livesync join <session-id> [filepath]  # Join an existing session
  -r, --relay <url>                    # Custom relay URL (default: public relay)
```

## Editor Setup

LiveSync writes changes to disk — your editor needs to detect and reload external changes. Most editors do this automatically, but some need a nudge:

| Editor | Setup |
|--------|-------|
| **VS Code** | Works out of the box |
| **Sublime Text** | Works out of the box |
| **JetBrains IDEs** | Reloads on window focus |
| **Vim / Neovim** | Add to config: `set autoread` and `autocmd FocusGained,CursorHold * checktime` |
| **Emacs** | Enable `auto-revert-mode` |

LiveSync prints a reminder about this on startup.

## Development

### Prerequisites

- Node.js (v18+)
- npm

### Project Structure

```
livesync/
├── src/                 # CLI client
│   ├── cli.ts           # Entry point, argument parsing
│   ├── client.ts        # File watching, WebSocket connection, sync loop
│   ├── crdt.ts          # Yjs document management, diffing
│   └── protocol.ts      # Message types, encoding/decoding
├── relay/               # Relay server (Cloudflare Workers + Durable Objects)
│   ├── wrangler.toml    # Workers config
│   └── src/
│       ├── index.ts     # Worker entry point, routing
│       └── session.ts   # Durable Object: session state, WebSocket handling
├── tests/               # Tests
└── sharing/             # Announcement / press copy
```

### Setting Up the CLI Client

```bash
# Install dependencies
npm install

# Build (TypeScript → dist/)
npm run build

# Or run directly in dev mode (no build step)
npm run dev -- share notes.md
npm run dev -- join abc123
```

### Setting Up the Relay Server

The relay is a Cloudflare Workers project using Durable Objects. You can run it locally for development:

```bash
cd relay
npm install

# Start local dev server (uses Miniflare under the hood)
npm run dev
```

The local relay runs at `http://localhost:8787`. Point the CLI at it with `--relay`:

```bash
livesync share notes.md --relay http://localhost:8787
```

To deploy to Cloudflare:

```bash
cd relay
npm run deploy
```

### Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/). Test files live in `tests/`.

### Key Dependencies

**CLI:**
- [yjs](https://github.com/yjs/yjs) — CRDT for conflict-free merging
- [fast-diff](https://github.com/nicokant/fast-diff) — Text diffing for file-to-CRDT updates
- [chokidar](https://github.com/paulmillr/chokidar) — Cross-platform file watching
- [ws](https://github.com/websockets/ws) — WebSocket client
- [commander](https://github.com/tj/commander.js) — CLI argument parsing

**Relay:**
- [yjs](https://github.com/yjs/yjs) — Maintains doc state for new joiners
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) — Cloudflare Workers dev/deploy

## Architecture

LiveSync has three components:

1. **CLI client** — Node.js tool that watches a local file, maintains a Yjs CRDT document, and syncs via WebSocket
2. **Relay server** — Lightweight WebSocket relay on Cloudflare Workers + Durable Objects. Holds session state in memory, broadcasts CRDT updates between clients. Sessions are ephemeral — when everyone disconnects, the state is gone.
3. **Web viewer** (planned) — Read-only browser view of any active session

The relay is intentionally simple: it forwards opaque binary CRDT updates between clients without understanding document contents. No data is persisted.

## Contributing

This is an early alpha project — contributions, bug reports, and feedback are all welcome. Open an issue or submit a PR.

## License

MIT
