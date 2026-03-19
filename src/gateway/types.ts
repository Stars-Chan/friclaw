// src/gateway/types.ts
import type { Dispatcher } from '../dispatcher'

export interface Gateway {
  readonly kind: string
  start(dispatcher: Dispatcher): Promise<void>
  stop(): Promise<void>
}
