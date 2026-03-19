export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    const b = result[key]
    const o = override[key]
    if (isPlainObject(o) && isPlainObject(b)) {
      result[key] = deepMerge(
        b as Record<string, unknown>,
        o as Record<string, unknown>,
      )
    } else {
      result[key] = o
    }
  }
  return result
}

export function removeUndefined(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (val === undefined) continue
    result[key] = isPlainObject(val)
      ? removeUndefined(val as Record<string, unknown>)
      : val
  }
  return result
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}
