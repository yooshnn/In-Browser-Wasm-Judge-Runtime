import { describe, expect, it } from 'vitest';
import { parseSysrootTar } from '../../src/internal/toolchain/loadSysrootArchive.js';

function tarHeader(name: string, size: number, typeflag = '0'): Uint8Array {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();

  header.set(encoder.encode(name), 0);

  const sizeOctal = size.toString(8).padStart(11, '0') + '\0';
  header.set(encoder.encode(sizeOctal), 124);
  header[156] = typeflag.charCodeAt(0);

  const magic = encoder.encode('ustar');
  header.set(magic, 257);
  header[262] = 0;
  header[263] = 48;
  header[264] = 48;

  for (let i = 148; i < 156; i += 1) header[i] = 32;
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumOctal = checksum.toString(8).padStart(6, '0');
  header.set(encoder.encode(checksumOctal), 148);
  header[154] = 0;
  header[155] = 32;

  return header;
}

function buildTar(entries: Array<{ name: string; data: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const entry of entries) {
    const data = encoder.encode(entry.data);
    chunks.push(tarHeader(entry.name, data.byteLength));
    chunks.push(data);
    const padding = (512 - (data.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(new Uint8Array(padding));
  }

  chunks.push(new Uint8Array(1024));

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return tar;
}

describe('parseSysrootTar', () => {
  it('strips the sysroot/ prefix from tar entries', () => {
    const tar = buildTar([
      { name: 'sysroot/include/wasm32-wasi/c++/v1/iostream', data: 'header' },
      { name: 'sysroot/lib/wasm32-wasi/crt1.o', data: 'crt' },
    ]);

    const entries = parseSysrootTar(tar);

    expect(entries).toEqual([
      { path: '/include/wasm32-wasi/c++/v1/iostream', data: new TextEncoder().encode('header') },
      { path: '/lib/wasm32-wasi/crt1.o', data: new TextEncoder().encode('crt') },
    ]);
  });

  it('keeps non-sysroot entries as absolute paths', () => {
    const tar = buildTar([{ name: 'manifest.json', data: '{}' }]);

    const entries = parseSysrootTar(tar);

    expect(entries).toEqual([
      { path: '/manifest.json', data: new TextEncoder().encode('{}') },
    ]);
  });

  it('ignores directory entries', () => {
    const tar = buildTar([{ name: 'sysroot/include/wasm32-wasi/', data: '' }]);
    tar[156] = '5'.charCodeAt(0);

    const entries = parseSysrootTar(tar);

    expect(entries).toEqual([]);
  });
});
