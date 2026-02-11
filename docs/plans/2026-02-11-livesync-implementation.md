# LiveSync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI tool for real-time collaborative editing of local files via a CRDT-based relay.

**Architecture:** CLI watches files on disk, diffs changes into a Yjs CRDT document, and syncs updates over WebSocket through a Cloudflare Workers relay. Two-person bidirectional sync with conflict resolution on join.

**Tech Stack:** TypeScript, Yjs, chokidar, ws, Commander, Cloudflare Workers + Durable Objects, vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `relay/package.json`
- Create: `relay/wrangler.toml`
- Create: `relay/tsconfig.json`
- Create: `src/.gitkeep` (placeholder)
- Create: `tests/.gitkeep` (placeholder)

**Step 1: Create package.json**

```json
{
  "name": "livesync",
  "version": "0.1.0",
  "description": "Real-time collaboration on local files via a tunnel",
  "type": "module",
  "bin": {
    "livesync": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chokidar": "^4.0.0",
    "commander": "^12.0.0",
    "fast-diff": "^1.3.0",
    "ws": "^8.16.0",
    "yjs": "^13.6.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "relay"]
}
```

**Step 3: Create relay/package.json**

```json
{
  "name": "livesync-relay",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "yjs": "^13.6.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240117.0",
    "wrangler": "^3.0.0"
  }
}
```

**Step 4: Create relay/wrangler.toml**

```toml
name = "livesync-relay"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "SESSION", class_name = "Session" }
]

[[migrations]]
tag = "v1"
new_classes = ["Session"]
```

**Step 5: Create relay/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src", "../src/protocol.ts"]
}
```

**Step 6: Install dependencies**

Run: `npm install` in project root
Run: `cd relay && npm install` in relay directory

**Step 7: Commit**

```bash
git add package.json tsconfig.json relay/ src/.gitkeep tests/.gitkeep
git commit -m "chore: scaffold project structure and dependencies"
```

---

### Task 2: Protocol Module (TDD)

**Files:**
- Create: `src/protocol.ts`
- Create: `tests/protocol.test.ts`

**Step 1: Write the failing tests**

Create `tests/protocol.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { MessageType, encodeMessage, decodeMessage } from '../src/protocol.js'

describe('protocol', () => {
  test('round-trips sync-state message', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const encoded = encodeMessage(MessageType.SyncState, data)
    const decoded = decodeMessage(encoded)
    expect(decoded.type).toBe(MessageType.SyncState)
    expect(decoded.data).toEqual(data)
  })

  test('round-trips sync-update message', () => {
    const data = new Uint8Array([10, 20, 30])
    const encoded = encodeMessage(MessageType.SyncUpdate, data)
    const decoded = decodeMessage(encoded)
    expect(decoded.type).toBe(MessageType.SyncUpdate)
    expect(decoded.data).toEqual(data)
  })

  test('handles empty payload', () => {
    const data = new Uint8Array([])
    const encoded = encodeMessage(MessageType.SyncState, data)
    const decoded = decodeMessage(encoded)
    expect(decoded.type).toBe(MessageType.SyncState)
    expect(decoded.data.length).toBe(0)
  })

  test('first byte is message type', () => {
    const encoded = encodeMessage(MessageType.SyncUpdate, new Uint8Array([99]))
    expect(encoded[0]).toBe(MessageType.SyncUpdate)
    expect(encoded[1]).toBe(99)
  })
})
```

**Step 2: Run tests to verify failure**

Run: `npx vitest run tests/protocol.test.ts`
Expected: FAIL — cannot resolve `../src/protocol.js`

**Step 3: Write implementation**

Create `src/protocol.ts`:

```typescript
export enum MessageType {
  SyncState = 0x01,
  SyncUpdate = 0x02,
}

export function encodeMessage(type: MessageType, data: Uint8Array): Uint8Array {
  const msg = new Uint8Array(1 + data.length)
  msg[0] = type
  msg.set(data, 1)
  return msg
}

export function decodeMessage(msg: Uint8Array): { type: MessageType; data: Uint8Array } {
  return {
    type: msg[0] as MessageType,
    data: msg.slice(1),
  }
}
```

**Step 4: Run tests to verify pass**

Run: `npx vitest run tests/protocol.test.ts`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add src/protocol.ts tests/protocol.test.ts
git commit -m "feat: add binary message protocol for relay communication"
```

---

### Task 3: CRDT Module (TDD)

**Files:**
- Create: `src/crdt.ts`
- Create: `tests/crdt.test.ts`

**Step 1: Write the failing tests**

Create `tests/crdt.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import * as Y from 'yjs'
import { createDoc, getText, applyTextDiff, encodeState, applyUpdate } from '../src/crdt.js'

describe('crdt', () => {
  test('creates empty doc', () => {
    const doc = createDoc()
    expect(getText(doc)).toBe('')
  })

  test('sets and gets text via diff', () => {
    const doc = createDoc()
    applyTextDiff(doc, 'hello world')
    expect(getText(doc)).toBe('hello world')
  })

  test('applies incremental diff', () => {
    const doc = createDoc()
    applyTextDiff(doc, 'hello world')
    applyTextDiff(doc, 'hello beautiful world')
    expect(getText(doc)).toBe('hello beautiful world')
  })

  test('handles deletion', () => {
    const doc = createDoc()
    applyTextDiff(doc, 'hello beautiful world')
    applyTextDiff(doc, 'hello world')
    expect(getText(doc)).toBe('hello world')
  })

  test('no-op when text is unchanged', () => {
    const doc = createDoc()
    applyTextDiff(doc, 'hello')

    let updateCount = 0
    doc.on('update', () => updateCount++)
    applyTextDiff(doc, 'hello')

    expect(updateCount).toBe(0)
  })

  test('syncs full state between docs', () => {
    const doc1 = createDoc()
    applyTextDiff(doc1, 'hello world')

    const doc2 = createDoc()
    applyUpdate(doc2, encodeState(doc1))

    expect(getText(doc2)).toBe('hello world')
  })

  test('merges concurrent edits from two docs', () => {
    const doc1 = createDoc()
    const doc2 = createDoc()

    // Shared initial state
    applyTextDiff(doc1, 'hello world')
    applyUpdate(doc2, encodeState(doc1))
    expect(getText(doc2)).toBe('hello world')

    // Capture incremental updates
    const updates1: Uint8Array[] = []
    const updates2: Uint8Array[] = []
    doc1.on('update', (update: Uint8Array) => updates1.push(update))
    doc2.on('update', (update: Uint8Array) => updates2.push(update))

    // Concurrent edits: doc1 inserts "beautiful ", doc2 appends "!"
    applyTextDiff(doc1, 'hello beautiful world')
    applyTextDiff(doc2, 'hello world!')

    // Exchange updates
    for (const update of updates1) applyUpdate(doc2, update)
    for (const update of updates2) applyUpdate(doc1, update)

    // Both converge to same result containing both edits
    expect(getText(doc1)).toBe(getText(doc2))
    expect(getText(doc1)).toContain('beautiful')
    expect(getText(doc1)).toContain('!')
  })
})
```

**Step 2: Run tests to verify failure**

Run: `npx vitest run tests/crdt.test.ts`
Expected: FAIL — cannot resolve `../src/crdt.js`

**Step 3: Write implementation**

Create `src/crdt.ts`:

```typescript
import * as Y from 'yjs'
import diff from 'fast-diff'

export function createDoc(): Y.Doc {
  return new Y.Doc()
}

export function getText(doc: Y.Doc): string {
  return doc.getText('content').toString()
}

export function applyTextDiff(doc: Y.Doc, newText: string): void {
  const ytext = doc.getText('content')
  const currentText = ytext.toString()

  if (currentText === newText) return

  const diffs = diff(currentText, newText)

  doc.transact(() => {
    let index = 0
    for (const [op, text] of diffs) {
      if (op === diff.EQUAL) {
        index += text.length
      } else if (op === diff.INSERT) {
        ytext.insert(index, text)
        index += text.length
      } else if (op === diff.DELETE) {
        ytext.delete(index, text.length)
      }
    }
  })
}

export function encodeState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc)
}

export function applyUpdate(doc: Y.Doc, update: Uint8Array, origin?: string): void {
  Y.applyUpdate(doc, update, origin)
}
```

**Step 4: Run tests to verify pass**

Run: `npx vitest run tests/crdt.test.ts`
Expected: 7 tests PASS

**Step 5: Commit**

```bash
git add src/crdt.ts tests/crdt.test.ts
git commit -m "feat: add CRDT module with Yjs text diffing and merge"
```

---

### Task 4: Relay Server

**Files:**
- Create: `relay/src/index.ts`
- Create: `relay/src/session.ts`

**Step 1: Write the Session Durable Object**

Create `relay/src/session.ts`:

```typescript
import * as Y from 'yjs'
import { MessageType, encodeMessage, decodeMessage } from '../../src/protocol.js'

export class Session {
  private doc: Y.Doc
  private connections: Set<WebSocket>

  constructor(private state: DurableObjectState, private env: unknown) {
    this.doc = new Y.Doc()
    this.connections = new Set()
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    server.accept()
    this.connections.add(server)

    // Send current document state to new joiner
    const state = Y.encodeStateAsUpdate(this.doc)
    server.send(encodeMessage(MessageType.SyncState, state))

    server.addEventListener('message', (event) => {
      const msg = decodeMessage(new Uint8Array(event.data as ArrayBuffer))
      if (msg.type === MessageType.SyncUpdate) {
        Y.applyUpdate(this.doc, msg.data)
        // Broadcast to all other connections
        for (const conn of this.connections) {
          if (conn !== server) {
            conn.send(encodeMessage(MessageType.SyncUpdate, msg.data))
          }
        }
      }
    })

    server.addEventListener('close', () => {
      this.connections.delete(server)
    })

    server.addEventListener('error', () => {
      this.connections.delete(server)
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}
```

**Step 2: Write the Worker entry point**

Create `relay/src/index.ts`:

```typescript
import { Session } from './session.js'

interface Env {
  SESSION: DurableObjectNamespace
}

function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS headers for web viewer (future)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Create new session
    if (url.pathname === '/session' && request.method === 'POST') {
      const sessionId = generateSessionId()
      return new Response(JSON.stringify({ sessionId }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // Connect to existing session via WebSocket
    const match = url.pathname.match(/^\/session\/([a-z0-9]+)$/)
    if (match) {
      const sessionId = match[1]
      const id = env.SESSION.idFromName(sessionId)
      const stub = env.SESSION.get(id)
      return stub.fetch(request)
    }

    return new Response('Not found', { status: 404 })
  },
}

export { Session }
```

**Step 3: Verify relay starts locally**

Run: `cd relay && npx wrangler dev`
Expected: Relay starts on `http://localhost:8787`

**Step 4: Commit**

```bash
git add relay/src/
git commit -m "feat: add relay server with Durable Object sessions"
```

---

### Task 5: Client — Share

**Files:**
- Create: `src/client.ts`

**Step 1: Write the share function**

Create `src/client.ts`:

```typescript
import * as Y from 'yjs'
import { watch, type FSWatcher } from 'chokidar'
import WebSocket from 'ws'
import { readFile, writeFile } from 'node:fs/promises'
import { createDoc, getText, applyTextDiff, applyUpdate } from './crdt.js'
import { MessageType, encodeMessage, decodeMessage } from './protocol.js'

export interface SyncSession {
  sessionId: string
  stop(): void
}

export async function share(filepath: string, relayUrl: string): Promise<SyncSession> {
  const content = await readFile(filepath, 'utf-8')

  // Create session on relay
  const res = await fetch(`${relayUrl}/session`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to create session: ${res.statusText}`)
  const { sessionId } = (await res.json()) as { sessionId: string }

  const doc = createDoc()
  const wsUrl = relayUrl.replace(/^http/, 'ws')
  const ws = new WebSocket(`${wsUrl}/session/${sessionId}`)

  let skipNextWatch = false

  // Send local CRDT updates to relay
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote' && ws.readyState === WebSocket.OPEN) {
      ws.send(encodeMessage(MessageType.SyncUpdate, update))
    }
  })

  // Receive remote updates from relay
  ws.on('message', async (data: Buffer) => {
    const msg = decodeMessage(new Uint8Array(data))
    if (msg.type === MessageType.SyncUpdate) {
      applyUpdate(doc, msg.data, 'remote')
      skipNextWatch = true
      await writeFile(filepath, getText(doc))
    }
  })

  ws.on('error', (err) => {
    console.error('Connection error:', err.message)
    process.exit(1)
  })

  // Wait for WebSocket to open
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })

  // Load file content into CRDT (triggers update → sent to relay)
  applyTextDiff(doc, content)

  // Watch file for local changes
  const watcher = watch(filepath, {
    awaitWriteFinish: { stabilityThreshold: 50 },
  })

  watcher.on('change', async () => {
    if (skipNextWatch) {
      skipNextWatch = false
      return
    }
    try {
      const newContent = await readFile(filepath, 'utf-8')
      applyTextDiff(doc, newContent)
    } catch {
      // File might be mid-write, ignore
    }
  })

  return {
    sessionId,
    stop() {
      watcher.close()
      ws.close()
    },
  }
}
```

**Step 2: Commit**

```bash
git add src/client.ts
git commit -m "feat: add client share with file watching and sync"
```

---

### Task 6: Client — Join

**Files:**
- Modify: `src/client.ts`

**Step 1: Add the join function and conflict prompt**

Append to `src/client.ts`:

```typescript
import { existsSync } from 'node:fs'
import * as readline from 'node:readline'

async function promptConflict(): Promise<'remote' | 'local'> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(
      'Local file differs from remote. Use (r)emote or keep (l)ocal? ',
      (answer) => {
        rl.close()
        resolve(answer.toLowerCase().startsWith('l') ? 'local' : 'remote')
      }
    )
  })
}

export async function join(
  sessionId: string,
  filepath: string,
  relayUrl: string
): Promise<SyncSession> {
  const doc = createDoc()
  const wsUrl = relayUrl.replace(/^http/, 'ws')
  const ws = new WebSocket(`${wsUrl}/session/${sessionId}`)

  let initialized = false
  let skipNextWatch = false

  // Send local CRDT updates to relay
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote' && ws.readyState === WebSocket.OPEN) {
      ws.send(encodeMessage(MessageType.SyncUpdate, update))
    }
  })

  // Set up message handling and wait for initial state
  const initPromise = new Promise<void>((resolve) => {
    ws.on('message', async (data: Buffer) => {
      const msg = decodeMessage(new Uint8Array(data))

      if (msg.type === MessageType.SyncState && !initialized) {
        applyUpdate(doc, msg.data, 'remote')
        initialized = true
        resolve()
        return
      }

      if (msg.type === MessageType.SyncUpdate && initialized) {
        applyUpdate(doc, msg.data, 'remote')
        skipNextWatch = true
        await writeFile(filepath, getText(doc))
      }
    })
  })

  ws.on('error', (err) => {
    console.error('Connection error:', err.message)
    process.exit(1)
  })

  await initPromise

  // Conflict resolution
  const remoteText = getText(doc)
  if (existsSync(filepath)) {
    const localContent = await readFile(filepath, 'utf-8')
    if (localContent !== remoteText) {
      const choice = await promptConflict()
      if (choice === 'local') {
        applyTextDiff(doc, localContent) // Generates update → sent to relay
      }
    }
  }

  // Write current state to disk
  skipNextWatch = true
  await writeFile(filepath, getText(doc))

  // Watch file for local changes
  const watcher = watch(filepath, {
    awaitWriteFinish: { stabilityThreshold: 50 },
  })

  watcher.on('change', async () => {
    if (skipNextWatch) {
      skipNextWatch = false
      return
    }
    try {
      const newContent = await readFile(filepath, 'utf-8')
      applyTextDiff(doc, newContent)
    } catch {
      // File might be mid-write, ignore
    }
  })

  return {
    sessionId,
    stop() {
      watcher.close()
      ws.close()
    },
  }
}
```

Note: The `existsSync` and `readline` imports should be at the top of client.ts alongside the other imports.

**Step 2: Commit**

```bash
git add src/client.ts
git commit -m "feat: add client join with conflict resolution"
```

---

### Task 7: CLI Entry Point

**Files:**
- Create: `src/cli.ts`

**Step 1: Write the CLI**

Create `src/cli.ts`:

```typescript
import { Command } from 'commander'
import { share, join } from './client.js'
import { resolve } from 'node:path'

const DEFAULT_RELAY = 'http://localhost:8787'

const program = new Command()

program
  .name('livesync')
  .description('Real-time collaboration on local files')
  .version('0.1.0')

program
  .command('share <filepath>')
  .description('Share a file for real-time collaboration')
  .option('-r, --relay <url>', 'Relay server URL', DEFAULT_RELAY)
  .action(async (filepath: string, options: { relay: string }) => {
    const fullPath = resolve(filepath)

    console.log(`Tip: Make sure your editor auto-reloads files changed on disk.`)
    console.log()

    try {
      const session = await share(fullPath, options.relay)

      console.log(`Sharing ${filepath}`)
      console.log(`Session: ${session.sessionId}`)
      console.log()
      console.log(`Others can join with:`)
      console.log(`  livesync join ${session.sessionId}`)
      console.log()
      console.log(`Press Ctrl+C to stop sharing.`)

      process.on('SIGINT', () => {
        session.stop()
        console.log('\nStopped sharing.')
        process.exit(0)
      })
    } catch (err) {
      console.error('Failed to share:', (err as Error).message)
      process.exit(1)
    }
  })

program
  .command('join <session-id> [filepath]')
  .description('Join a shared file session')
  .option('-r, --relay <url>', 'Relay server URL', DEFAULT_RELAY)
  .action(
    async (
      sessionId: string,
      filepath: string | undefined,
      options: { relay: string }
    ) => {
      // Default filename: use session ID if not specified
      const file = filepath ?? `${sessionId}.md`
      const fullPath = resolve(file)

      console.log(`Tip: Make sure your editor auto-reloads files changed on disk.`)
      console.log()

      try {
        const session = await join(sessionId, fullPath, options.relay)

        console.log(`Joined session ${sessionId}`)
        console.log(`Syncing to ${file}`)
        console.log()
        console.log(`Press Ctrl+C to stop.`)

        process.on('SIGINT', () => {
          session.stop()
          console.log('\nDisconnected.')
          process.exit(0)
        })
      } catch (err) {
        console.error('Failed to join:', (err as Error).message)
        process.exit(1)
      }
    }
  )

program.parse()
```

**Step 2: Verify CLI starts**

Run: `npx tsx src/cli.ts --help`
Expected: Shows help with `share` and `join` commands

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI with share and join commands"
```

---

### Task 8: End-to-End Test

**Files:** None (manual testing)

**Step 1: Start the relay**

Terminal 1:
```bash
cd relay && npx wrangler dev
```
Expected: Relay running on `http://localhost:8787`

**Step 2: Share a file**

Terminal 2:
```bash
echo "# Hello from LiveSync" > /tmp/test-share.md
npx tsx src/cli.ts share /tmp/test-share.md
```
Expected: Prints session ID (e.g. `abc123`)

**Step 3: Join the session**

Terminal 3:
```bash
npx tsx src/cli.ts join <session-id> /tmp/test-join.md
```
Expected: Creates `/tmp/test-join.md` with content "# Hello from LiveSync"

**Step 4: Test sync — sharer to joiner**

In any editor, modify `/tmp/test-share.md` and save.
Expected: `/tmp/test-join.md` updates within ~200ms.

**Step 5: Test sync — joiner to sharer**

In any editor, modify `/tmp/test-join.md` and save.
Expected: `/tmp/test-share.md` updates within ~200ms.

**Step 6: Test conflict resolution**

```bash
echo "local content" > /tmp/test-conflict.md
npx tsx src/cli.ts join <session-id> /tmp/test-conflict.md
```
Expected: Prompts "Local file differs from remote. Use (r)emote or keep (l)ocal?"

**Step 7: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```
