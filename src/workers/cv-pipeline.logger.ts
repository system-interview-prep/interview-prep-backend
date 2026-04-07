/**
 * Log có cấu trúc cho CV pipeline worker — dễ grep / CloudWatch filter.
 * Format: [CV pipeline][cv=<id>] [STEP] <name> ...meta
 */

export type PipelineLogger = {
  info: (step: string, meta?: Record<string, unknown>) => void;
  warn: (step: string, meta?: Record<string, unknown>) => void;
  error: (step: string, meta?: Record<string, unknown> | Error) => void;
  /** Chạy async, log START / OK|FAIL + durationMs */
  time: <T>(step: string, fn: () => Promise<T>, meta?: Record<string, unknown>) => Promise<T>;
};

function safeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string' && v.length > 500) {
      out[k] = `${v.slice(0, 500)}…(len=${v.length})`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createPipelineLogger(cvId: string): PipelineLogger {
  const tag = `[CV pipeline][cv=${cvId}]`;

  return {
    info(step, meta) {
      const m = safeMeta(meta);
      if (m && Object.keys(m).length) {
        console.log(`${tag} [${step}]`, m);
      } else {
        console.log(`${tag} [${step}]`);
      }
    },
    warn(step, meta) {
      console.warn(`${tag} [${step}]`, safeMeta(meta) ?? '');
    },
    error(step, meta) {
      if (meta instanceof Error) {
        console.error(`${tag} [${step}]`, meta.message, meta.stack);
      } else {
        console.error(`${tag} [${step}]`, safeMeta(meta) ?? '');
      }
    },
    async time(step, fn, meta) {
      const t0 = Date.now();
      this.info(`${step}:START`, meta);
      try {
        const result = await fn();
        this.info(`${step}:OK`, { durationMs: Date.now() - t0, ...safeMeta(meta) });
        return result;
      } catch (e: any) {
        this.error(`${step}:FAIL`, {
          durationMs: Date.now() - t0,
          message: e?.message || String(e),
          ...safeMeta(meta),
        });
        throw e;
      }
    },
  };
}
