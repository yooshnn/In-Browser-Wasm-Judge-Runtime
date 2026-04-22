const store = new Map<string, Uint8Array>();

export function storeArtifact(id: string, binary: Uint8Array): void {
  store.set(id, binary);
}

export function getArtifact(id: string): Uint8Array | undefined {
  return store.get(id);
}
