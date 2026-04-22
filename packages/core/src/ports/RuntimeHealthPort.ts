import type { RuntimeHealth } from '../domain/execution/RuntimeHealth.js';

export interface RuntimeHealthPort {
  getHealth(): Promise<RuntimeHealth>;
}
