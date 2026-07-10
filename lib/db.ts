import "server-only";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

// A remote (e.g. Supabase cloud) connection needs TLS; the local stack doesn't.
const isRemote = !/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

// One shared connection pool for the app process.
const globalForSql = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export const sql =
  globalForSql.__sql ??
  postgres(connectionString, {
    max: 10,
    // keep numeric/jsonb as-is; we cast explicitly in queries
    transform: { undefined: null },
    ...(isRemote ? { ssl: "require" as const } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForSql.__sql = sql;
