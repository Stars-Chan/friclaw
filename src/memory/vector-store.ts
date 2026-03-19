// src/memory/vector-store.ts
// P2 — Vector search stub. Full implementation requires Qdrant + OpenAI embeddings.
// When vectorEnabled=true in config, this module will be wired in; for now it is a no-op.

export interface VectorSearchResult {
  id: string
  score: number
  payload: Record<string, unknown>
}

export class VectorStore {
  private enabled = false

  constructor(private endpoint: string) {
    this.enabled = !!endpoint
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async init(): Promise<void> {
    // TODO: connect to Qdrant, create collection if not exists
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async upsert(_id: string, _text: string, _payload: Record<string, unknown>): Promise<void> {
    // TODO: embed text and upsert into Qdrant
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(_query: string, _limit = 10): Promise<VectorSearchResult[]> {
    // TODO: embed query and search Qdrant
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async delete(_id: string): Promise<void> {
    // TODO: delete vector from Qdrant
  }

  isEnabled(): boolean {
    return this.enabled
  }
}
