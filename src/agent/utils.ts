// src/agent/utils.ts
import type { ContentBlock } from './types'

export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) yield line
    }
    if (buf) yield buf
  } finally {
    reader.releaseLock()
  }
}

export function detectMime(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

export function buildContent(request: { text: string; attachments?: Array<{ type: 'image'; buffer: Buffer }> }): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text: request.text }]
  for (const att of request.attachments ?? []) {
    if (att.type === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: detectMime(att.buffer),
          data: att.buffer.toString('base64'),
        },
      })
    }
  }
  return blocks
}
