import { sql } from './db.js'

/**
 * The record of what an import displaced.
 *
 * Reversing an upload cannot just delete what it wrote. An import replaces a
 * month's facts, overwrites an ad spend somebody typed in, and deletes the
 * aggregate rows it restates — so removing only its own rows would leave the
 * month emptier than it was before the mistake. Whatever is about to be
 * overwritten is captured here first, and a reverse replays it.
 *
 * Capture is deliberately best-effort at the call sites but never silent: an
 * import that could not be captured is one that cannot be reversed cleanly,
 * and the reverse says so rather than half-restoring.
 */

export type UndoKind = 'facts' | 'sales_rows' | 'manual_ad_spend' | 'meesho_rows'

/** Records one displaced thing. `payload` null means there was nothing there,
 * so reversing removes what the import created instead of restoring. */
export async function captureUndo(
  importId: string | undefined,
  kind: UndoKind,
  target: string,
  payload: unknown,
): Promise<void> {
  if (!importId) return
  await sql.query(
    `INSERT INTO import_undo (import_id, kind, target, payload) VALUES ($1, $2, $3, $4)`,
    [importId, kind, target, payload === undefined ? null : JSON.stringify(payload)],
  )
}

/** The month's stored facts before this import overwrites them. */
export async function captureFactsUndo(importId: string | undefined, table: string, month: string): Promise<void> {
  if (!importId) return
  const rows = (await sql.query(`SELECT data FROM ${table} WHERE month = $1`, [month])) as { data?: unknown }[]
  await captureUndo(importId, 'facts', `${table}|${month}`, rows[0]?.data ?? null)
}

export interface UndoRow { kind: UndoKind; target: string; payload: unknown }

export async function undoRowsFor(importId: string): Promise<UndoRow[]> {
  // Newest first: a target written more than once in one import is restored to
  // the state it had before the import began, not to some point inside it.
  return (await sql.query(
    `SELECT kind, target, payload FROM import_undo WHERE import_id = $1 ORDER BY seq DESC`,
    [importId],
  )) as UndoRow[]
}

export async function clearUndo(importId: string): Promise<void> {
  await sql.query(`DELETE FROM import_undo WHERE import_id = $1`, [importId])
}
