/**
 * lib/events.ts
 *
 * Server-side funnel events, written as one structured log line each.
 *
 * Why not Vercel Web Analytics custom events: they are Pro-only (checked
 * 2026-10-26). `<Analytics />` still gives free page views on Hobby, but the
 * funnel we care about — started, finished, shared, listed — cannot be sent as
 * custom events on the free plan. Pretending otherwise would mean shipping
 * `track()` calls that silently do nothing.
 *
 * So: `console.info("[event]", ...)` and read them with `vercel logs` (D37).
 * Hobby keeps about 30 minutes of runtime logs, which is enough for a live
 * demo. Durable counts are already in Postgres and need no new service:
 *
 *   generations   select count(*) from projects;
 *   shares        select count(*) from projects where share_slug is not null;
 *   gallery       select count(*) from projects where gallery_listed;
 *
 * No user content, no ids of people, no IP addresses. A project id is included
 * because it is already exposed to its owner and makes a support question
 * answerable ("why did this one fail?"); it is not used for attribution.
 */

export type ServerEvent =
  | "generate_started"
  | "generate_done"
  | "share_created"
  | "share_revoked"
  | "gallery_listed"
  | "gallery_unlisted";

export function logEvent(
  event: ServerEvent,
  data: Record<string, string | number | boolean | null> = {},
): void {
  console.info("[event]", { event, ...data });
}
