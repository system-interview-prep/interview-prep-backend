/**
 * utils/index.ts – Shared utility functions across the application.
 */

/**
 * Generates a formatted ISO timestamp string.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Strips a prefix from a string (used for DynamoDB key parsing).
 * e.g. stripPrefix('SESSION#abc-123', 'SESSION#') => 'abc-123'
 */
export function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * Generates a DynamoDB partition key with a given prefix.
 * e.g. pk('SESSION', 'abc-123') => 'SESSION#abc-123'
 */
export function pk(prefix: string, id: string): string {
  return `${prefix}#${id}`;
}

/**
 * Simple sleep utility for async delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
