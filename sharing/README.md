# LiveSync — Sharing & Messaging

## Title

**LiveSync: Real-Time Collaboration on Local Files**

## Tagline

*Google Docs-style collaboration, but for files on your disk, in your editor.*

## Blurb

LiveSync lets you collaboratively edit any text file in real-time — from the terminal, using whatever editor you already use. No browser tabs, no copy-pasting, no leaving your workflow. Just run `livesync share`, hand the session code to a collaborator, and start editing together.

---

## Announcement (short-form)

### LiveSync — real-time collaboration without leaving your editor

We built LiveSync because we were tired of the dance: hop into Google Docs or HackMD to collaborate, then copy everything back to the files we actually work with. We wanted the multiplayer part without the context switch.

LiveSync is a small CLI tool that watches a file on disk and syncs it in real-time to anyone else running the same session. You edit in Vim, your collaborator edits in VS Code, and changes flow both ways instantly. It uses CRDTs (via Yjs) under the hood, so concurrent edits merge cleanly — no locking, no conflicts.

The setup is two commands:

```
livesync share notes.md        # You get a session code
livesync join abc123            # Your collaborator runs this
```

That's it. Both of you now have a live-syncing copy of the file. Edit, save, and it shows up on the other side in under a second.

The relay server runs on Cloudflare Workers so there's nothing to host and no accounts to create. Sessions are ephemeral — when everyone disconnects, the state is gone. Your files stay on your machines.

LiveSync is open source (MIT), free to use, and currently in alpha. It works well for markdown documents, meeting notes, pair-writing sessions, and lightweight co-editing of code and config files. We're using it ourselves daily and shipping improvements as we go.

We'd love early adopters to try it out and tell us what breaks. If you've ever wished you could just `share` a file the way you `cat` a file, give it a spin.

**GitHub:** github.com/nicokant/livesync
**License:** MIT
**Status:** Alpha — expect rough edges, report them generously

### What makes it different

- **Editor-agnostic.** Vim, Emacs, VS Code, Sublime, nano — if it reads and writes files, it works with LiveSync.
- **No accounts, no setup.** Install, run, share. The relay is public and free.
- **Files stay local.** There's no cloud document. You have a file on disk. Your collaborator has a file on disk. LiveSync just keeps them in sync.
- **CRDT-powered merging.** Edits at different positions merge perfectly. Even simultaneous edits to the same line resolve deterministically — no manual conflict resolution.
- **Ephemeral by design.** Sessions live only as long as someone is connected. No data is persisted on the relay.

### Who it's for

- Developers who want to co-edit markdown, config files, or code without leaving the terminal
- Writers who pair on documents but prefer local editors over web apps
- Anyone who's ever wanted "Google Docs but for local files"

### What's next

- Web viewer — a read-only browser view of any active session (great for screen-share-free demos)
- Multi-file sync — share a whole directory
- Awareness — see who's connected and where their cursor is
- npm global install for one-command setup

---

## Key Facts

| | |
|---|---|
| **Name** | LiveSync |
| **What** | CLI tool for real-time collaborative editing of local files |
| **How** | File watcher + CRDT (Yjs) + WebSocket relay on Cloudflare Workers |
| **Install** | `npm install` (global install coming soon) |
| **License** | MIT |
| **Status** | Alpha — free and open source |
| **Repo** | github.com/nicokant/livesync |
