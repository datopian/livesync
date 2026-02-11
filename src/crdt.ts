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
