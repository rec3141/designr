import { createClient, type Client } from "@libsql/client";

// Tiny KV-ish store keyed on Pinterest user id, backed by libSQL (Turso in
// production, local file in dev). Sessions are stored as a JSON blob
// alongside a few denormalized columns for listing without parsing.
//
// Env:
//   TURSO_DATABASE_URL  e.g. libsql://designr-hawkwing3141.turso.io  (prod)
//                      or  file:./data/designr.db                    (dev)
//   TURSO_AUTH_TOKEN    required for remote libsql URLs
//
// If TURSO_DATABASE_URL is unset we fall back to a local file for dev.

let _client: Client | null = null;
let _initPromise: Promise<Client> | null = null;

async function getClient(): Promise<Client> {
  if (_client) return _client;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const url = process.env.TURSO_DATABASE_URL || "file:./data/designr.db";
    const authToken = process.env.TURSO_AUTH_TOKEN;
    const client = createClient({ url, authToken });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source_board_id TEXT NOT NULL,
        source_board_name TEXT NOT NULL,
        mode TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);
    await client.execute(
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC)`
    );
    _client = client;
    return client;
  })();
  return _initPromise;
}

export type StoredSessionSummary = {
  id: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  sourceBoardId: string;
  sourceBoardName: string;
  mode: string;
  entryCount: number;
};

export type StoredSessionRow = StoredSessionSummary & { data: string };

type RawRow = Record<string, unknown>;

function rowToSummary(r: RawRow): StoredSessionSummary {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    sourceBoardId: String(r.source_board_id),
    sourceBoardName: String(r.source_board_name),
    mode: String(r.mode),
    entryCount: Number(r.entry_count),
  };
}

export async function listSessionsForUser(
  userId: string
): Promise<StoredSessionSummary[]> {
  const db = await getClient();
  const res = await db.execute({
    sql: `SELECT id, user_id, created_at, updated_at, source_board_id,
                 source_board_name, mode, entry_count
            FROM sessions
           WHERE user_id = ?
           ORDER BY updated_at DESC`,
    args: [userId],
  });
  return res.rows.map((r) => rowToSummary(r as unknown as RawRow));
}

export async function getSessionById(
  userId: string,
  id: string
): Promise<StoredSessionRow | null> {
  const db = await getClient();
  const res = await db.execute({
    sql: `SELECT id, user_id, created_at, updated_at, source_board_id,
                 source_board_name, mode, entry_count, data
            FROM sessions
           WHERE user_id = ? AND id = ?`,
    args: [userId, id],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0] as unknown as RawRow;
  return { ...rowToSummary(r), data: String(r.data) };
}

export type UpsertInput = {
  id?: string;
  userId: string;
  sourceBoardId: string;
  sourceBoardName: string;
  mode: string;
  entryCount: number;
  data: string;
};

export async function upsertSession(input: UpsertInput): Promise<string> {
  const now = Date.now();
  const id = input.id ?? randomId();
  const db = await getClient();
  const existing = await db.execute({
    sql: `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
    args: [id, input.userId],
  });
  if (existing.rows.length > 0) {
    await db.execute({
      sql: `UPDATE sessions
               SET updated_at = ?, source_board_id = ?, source_board_name = ?,
                   mode = ?, entry_count = ?, data = ?
             WHERE id = ? AND user_id = ?`,
      args: [
        now,
        input.sourceBoardId,
        input.sourceBoardName,
        input.mode,
        input.entryCount,
        input.data,
        id,
        input.userId,
      ],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO sessions (id, user_id, created_at, updated_at,
                                  source_board_id, source_board_name, mode,
                                  entry_count, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.userId,
        now,
        now,
        input.sourceBoardId,
        input.sourceBoardName,
        input.mode,
        input.entryCount,
        input.data,
      ],
    });
  }
  return id;
}

export async function deleteSession(userId: string, id: string): Promise<boolean> {
  const db = await getClient();
  const res = await db.execute({
    sql: `DELETE FROM sessions WHERE user_id = ? AND id = ?`,
    args: [userId, id],
  });
  return (res.rowsAffected ?? 0) > 0;
}

function randomId(): string {
  // 12 bytes of randomness, base36-ish. Not cryptographic — just a stable id.
  const a = Math.random().toString(36).slice(2, 10);
  const b = Date.now().toString(36);
  return `${b}${a}`;
}
