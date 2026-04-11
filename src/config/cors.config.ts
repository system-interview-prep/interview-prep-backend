function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return ['http://localhost:3000'];
  return raw
    .split(',')
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
}

const rawOrigins =
  process.env.CORS_ORIGIN ||
  process.env.HTTP_CORS_ORIGIN ||
  process.env.SOCKET_CORS_ORIGIN;

const parsed = parseCorsOrigins(rawOrigins);

export const corsOrigins = parsed.length > 0 ? parsed : ['http://localhost:3000'];
