export type SysrootEntry = { path: string; data: Uint8Array };

export function parseSysrootTar(decompressed: Uint8Array): SysrootEntry[] {
  const entries: SysrootEntry[] = [];
  let offset = 0;
  while (offset + 512 <= decompressed.byteLength) {
    const header = decompressed.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0/g, '');
    const prefix = new TextDecoder().decode(header.subarray(345, 500)).replace(/\0/g, '');
    const sizeText = new TextDecoder().decode(header.subarray(124, 136)).replace(/\0/g, '').trim();
    const size = sizeText === '' ? 0 : Number.parseInt(sizeText, 8);
    const typeflag = header[156];
    const fullName = prefix ? `${prefix}/${name}` : name;
    offset += 512;
    const fileData = decompressed.slice(offset, offset + size);
    if ((typeflag === 0 || typeflag === 48) && fullName !== '') {
      const stripped = fullName.startsWith('sysroot/') ? fullName.slice('sysroot'.length) : `/${fullName}`;
      entries.push({ path: stripped, data: fileData });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

export async function decompressGzIfNeeded(data: ArrayBuffer): Promise<Uint8Array> {
  const view = new DataView(data);
  const isGzip = view.byteLength >= 2 && view.getUint8(0) === 0x1f && view.getUint8(1) === 0x8b;
  if (!isGzip) return new Uint8Array(data);

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function loadSysrootEntriesFromArchive(data: ArrayBuffer): Promise<SysrootEntry[]> {
  const decompressed = await decompressGzIfNeeded(data);
  return parseSysrootTar(decompressed);
}
