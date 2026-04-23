import type { ExecutionFailure } from '@cupya.me/wasm-judge-runtime-core';
import { OutputLimitExceeded } from './errors.js';

export type OutputSnapshot = Pick<ExecutionFailure, 'stdout' | 'stderr'>;

export class OutputCollector {
  private readonly stdoutChunks: Uint8Array[] = [];
  private readonly stderrChunks: Uint8Array[] = [];
  private stdoutBytes = 0;
  private stderrBytes = 0;

  write(stream: 'stdout' | 'stderr', chunk: Uint8Array, limitBytes: number): void {
    if (stream === 'stdout') {
      this.stdoutChunks.push(chunk);
      this.stdoutBytes += chunk.byteLength;
    } else {
      this.stderrChunks.push(chunk);
      this.stderrBytes += chunk.byteLength;
    }

    if (this.bytesFor(stream) > limitBytes) {
      const { stdout, stderr } = this.snapshot();
      throw new OutputLimitExceeded(stream, stdout, stderr);
    }
  }

  snapshot(): OutputSnapshot {
    return {
      stdout: decodeUtf8(this.stdoutChunks),
      stderr: decodeUtf8(this.stderrChunks),
    };
  }

  private bytesFor(stream: 'stdout' | 'stderr'): number {
    return stream === 'stdout' ? this.stdoutBytes : this.stderrBytes;
  }
}

function decodeUtf8(chunks: Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}
