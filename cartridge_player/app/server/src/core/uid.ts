/**
 * Tag UIDs are stored exactly as ESPHome reported them (`04-A3-B8-8B-32-02-89`),
 * but matched on a normalised form. A firmware update that changes separators or
 * case must not orphan an entire shelf of cartridges (§10).
 */
export function normalizeUid(uid: string): string {
  return uid.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
}

/**
 * The same normalisation expressed in SQLite, so the lookup can use an index
 * instead of scanning. Kept next to `normalizeUid` because the two must agree.
 *
 * Only strips the separators ESPHome and NFC tooling actually emit — `-`, `:`,
 * `.`, space — which is the whole space of realistic UID formatting.
 */
export const SQL_NORMALIZED_UID =
  "UPPER(REPLACE(REPLACE(REPLACE(REPLACE(tag_uid, '-', ''), ':', ''), '.', ''), ' ', ''))"
