import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Resolves DATABASE_URL so relative SQLite paths always point inside
 * packages/database, regardless of which app's cwd we're running from.
 */
export function resolveDatabaseUrl(
  url = process.env.DATABASE_URL ?? "file:./dev.db",
): string {
  if (!url.startsWith("file:./") && !url.startsWith("file:../")) return url;
  return `file:${path.resolve(PACKAGE_ROOT, url.slice("file:".length))}`;
}
