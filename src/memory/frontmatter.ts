function normalizeArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed.map(item => String(item).trim()).filter(Boolean)
        }
      } catch {
        // fall through to legacy parser
      }
      return trimmed
        .slice(1, -1)
        .split(',')
        .map(item => item.trim().replace(/^['\"]|['\"]$/g, ''))
        .filter(Boolean)
    }
    return trimmed
      .split(',')
      .map(item => item.trim().replace(/^['\"]|['\"]$/g, ''))
      .filter(Boolean)
  }
  return []
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return normalizeArrayValue(trimmed)
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseFrontmatter<T extends object>(raw: string): { metadata: Partial<T>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/)
  if (!match) return { metadata: {}, body: raw.trim() }

  const [, frontmatter, body] = match
  const metadata: Record<string, unknown> = {}
  const lines = frontmatter.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1)

    if (value.trim() === '|' || value.trim() === '|-' || value.trim() === '|+') {
      const blockLines: string[] = []
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1]
        if (nextLine.startsWith('  ')) {
          blockLines.push(nextLine.slice(2))
          index += 1
          continue
        }
        if (nextLine.trim() === '') {
          blockLines.push('')
          index += 1
          continue
        }
        break
      }
      metadata[key] = blockLines.join('\n').replace(/\n+$/g, '')
      continue
    }

    metadata[key] = parseScalar(value)
  }

  return { metadata: metadata as Partial<T>, body: body.trim() }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(item => String(item)))
  }
  const stringValue = String(value)
  if (stringValue.includes('\n')) {
    const indented = stringValue.split('\n').map(line => `  ${line}`).join('\n')
    return `|\n${indented}`
  }
  if (/^[A-Za-z0-9._/-]+$/.test(stringValue)) {
    return stringValue
  }
  return JSON.stringify(stringValue)
}

export function serializeFrontmatter(metadata: object, body: string): string {
  const lines = Object.entries(metadata as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)

  return ['---', ...lines, '---', '', body.trim()].join('\n')
}

export function normalizeStringArray(value: unknown): string[] {
  return normalizeArrayValue(value)
}
