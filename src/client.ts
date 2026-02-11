import { watch } from 'chokidar'
import WebSocket from 'ws'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import * as readline from 'node:readline'
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
