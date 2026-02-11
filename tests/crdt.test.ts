import { describe, test, expect } from 'vitest'
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
