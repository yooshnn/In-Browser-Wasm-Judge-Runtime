export class WasiExit {
  constructor(readonly code: number) {}
}

export class OutputLimitExceeded {
  constructor(
    readonly stream: 'stdout' | 'stderr',
    readonly stdout: string,
    readonly stderr: string,
  ) {}
}

export class MemoryLimitExceeded {
  constructor(readonly reason: string) {}
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isLikelyMemoryLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('out of memory') ||
    message.includes('memory allocation') ||
    message.includes('insufficient memory') ||
    message.includes('could not allocate memory')
  );
}
