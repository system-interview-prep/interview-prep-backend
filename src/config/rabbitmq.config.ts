function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const rabbitMqConfig = {
  url: process.env.RABBITMQ_URL || 'amqp://interview:interview_password@localhost:5672',
  queues: {
    cv: process.env.RABBITMQ_CV_QUEUE || 'cv-processing',
    jobProfile: process.env.RABBITMQ_JP_QUEUE || 'jp-processing',
  },
  retryDelayMs: positiveNumber(process.env.RABBITMQ_RETRY_DELAY_MS, 10_000),
  maxAttempts: positiveNumber(process.env.RABBITMQ_MAX_ATTEMPTS, 3),
  prefetch: positiveNumber(process.env.RABBITMQ_PREFETCH, 1),
} as const;
