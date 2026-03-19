import { describe, it, expect } from 'bun:test'
import { deepMerge, removeUndefined } from '../../../src/utils/deep-merge'

describe('deepMerge', () => {
  it('override wins for scalar values', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  it('preserves base keys not in override', () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 })
  })

  it('recursively merges nested objects', () => {
    expect(deepMerge({ x: { a: 1, b: 2 } }, { x: { b: 9 } }))
      .toEqual({ x: { a: 1, b: 9 } })
  })

  it('override scalar replaces base object', () => {
    expect(deepMerge({ x: { a: 1 } }, { x: 'flat' as unknown }))
      .toEqual({ x: 'flat' })
  })
})

describe('removeUndefined', () => {
  it('removes undefined values', () => {
    expect(removeUndefined({ a: 1, b: undefined })).toEqual({ a: 1 })
  })

  it('recursively removes undefined in nested objects', () => {
    expect(removeUndefined({ x: { a: 1, b: undefined } }))
      .toEqual({ x: { a: 1 } })
  })

  it('preserves false and 0', () => {
    expect(removeUndefined({ a: false, b: 0, c: '' }))
      .toEqual({ a: false, b: 0, c: '' })
  })

  it('preserves null', () => {
    expect(removeUndefined({ a: null })).toEqual({ a: null })
  })
})
