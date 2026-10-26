/**
 * Sharing helpers shared by the server action and the project page.
 */

/** Shape of the subset of a PostgREST error we care about. */
export interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * True when the error is "the 0002 migration has not been applied yet".
 *
 * Postgres reports an unknown column as `42703`; PostgREST sometimes wraps it as
 * `PGRST204` ("column not found in schema cache") depending on whether the query
 * is a read or a write. Both mean the same thing to us.
 *
 * Detecting this lets the app keep working before the migration is run instead
 * of turning every project page into a 404.
 */
export function isMissingSharingColumn(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /share_slug|shared_at/i.test(`${error.message ?? ""} ${error.details ?? ""}`);
}
