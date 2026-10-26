/**
 * scripts/verify-actions.mts
 *
 * Offline regression checks for the rename / delete / share rules in
 * lib/project-ops.ts. No Supabase project, no session, no browser.
 *
 * Why a fake client instead of an integration test: these paths need a signed-in
 * user, so CI could never reach them; that is exactly how a rename that rotates
 * a live share slug, or a delete that reports success when RLS filtered the row,
 * would ship unnoticed. The fake is deliberately dumb — it records the chain and
 * returns a canned result — so the assertions are about our rules, not about
 * PostgREST.
 *
 * Run with:  npm run verify:actions
 */

import {
  deleteProjectWith,
  disableSharingWith,
  enableSharingWith,
  renameProjectWith,
  TITLE_MAX,
  type ActionsClient,
  type QueryBuilder,
  type QueryResult,
} from "@/lib/project-ops";

let failures = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       expected ${JSON.stringify(expected).slice(0, 180)}`);
    console.log(`       actual   ${JSON.stringify(actual).slice(0, 180)}`);
    return;
  }
  console.log(`  ok   ${label}`);
}

type Mode = "select" | "update" | "delete";

interface FakeOptions {
  signedIn?: boolean;
  /** Result for a read chain (`.select(...).maybeSingle()`). */
  read?: QueryResult<Record<string, unknown>>;
  /** Result for a write chain (`.update()/.delete()`). */
  write?: QueryResult<Record<string, unknown>>;
}

function createFake(options: FakeOptions = {}) {
  const { signedIn = true, read = { data: null, error: null }, write = { data: null, error: null } } = options;

  const calls: string[] = [];
  let mode: Mode = "select";
  let values: Record<string, unknown> | null = null;

  const builder: QueryBuilder = {
    select(columns) {
      calls.push(`select(${columns ?? "*"})`);
      return builder;
    },
    update(next) {
      mode = "update";
      values = next;
      calls.push("update");
      return builder;
    },
    delete() {
      mode = "delete";
      calls.push("delete");
      return builder;
    },
    eq(column, value) {
      calls.push(`eq(${column}=${String(value)})`);
      return builder;
    },
    async maybeSingle<T>() {
      const result = (mode === "select" ? read : write) as QueryResult<T>;
      return result;
    },
  };

  const client: ActionsClient = {
    auth: {
      async getUser() {
        calls.push("auth.getUser");
        return { data: { user: signedIn ? { id: "user-1" } : null } };
      },
    },
    from(table) {
      calls.push(`from(${table})`);
      return builder;
    },
  };

  return {
    client,
    calls,
    values: () => values,
    mode: () => mode,
    touchedTable: () => calls.some((call) => call.startsWith("from(")),
  };
}

const revalidated: string[] = [];
const revalidate = (path: string) => {
  revalidated.push(path);
};

function resetRevalidated() {
  revalidated.length = 0;
}

console.log("\n[1] rename: normalises the title, writes only that column");

{
  resetRevalidated();
  const fake = createFake({ write: { data: { id: "p1" }, error: null } });
  const result = await renameProjectWith(fake.client, "p1", "  My    roadmap  ", revalidate);

  expect("ok", result.ok, true);
  expect("only title is written", fake.values(), { title: "My roadmap" });
  expect(
    "query is scoped by id",
    fake.calls.includes("eq(id=p1)"),
    true,
  );
  expect("dashboard revalidated", revalidated.includes("/dashboard"), true);
  expect("project revalidated", revalidated.includes("/project/p1"), true);
}

console.log("\n[2] rename: rejected input never touches the database");

{
  const short = createFake();
  expect("too short", (await renameProjectWith(short.client, "p1", " a ", revalidate)).ok, false);
  expect("no table access", short.touchedTable(), false);

  const long = createFake();
  const result = await renameProjectWith(long.client, "p1", "x".repeat(TITLE_MAX + 1), revalidate);
  expect("too long", result.ok, false);
  expect("no table access", long.touchedTable(), false);
}

console.log("\n[3] rename: signed out and missing rows");

{
  const signedOut = createFake({ signedIn: false });
  const result = await renameProjectWith(signedOut.client, "p1", "Fine title", revalidate);
  expect("signed out", result.ok, false);
  expect("no table access", signedOut.touchedTable(), false);

  const missing = createFake({ write: { data: null, error: null } });
  const missingResult = await renameProjectWith(missing.client, "p1", "Fine title", revalidate);
  expect("missing row fails loudly", missingResult.ok, false);
  expect("message does not claim success", /does not exist|not yours/i.test(missingResult.error ?? ""), true);
}

console.log("\n[4] rename: a database error is not reported as success");

{
  const failing = createFake({ write: { data: null, error: { message: "permission denied" } } });
  const result = await renameProjectWith(failing.client, "p1", "Fine title", revalidate);
  expect("ok is false", result.ok, false);
  expect("generic message", result.error, "Could not rename that roadmap.");
}

console.log("\n[5] delete: removes the row and revalidates, no paper cleanup");

{
  resetRevalidated();
  const fake = createFake({ write: { data: { id: "p1" }, error: null } });
  const result = await deleteProjectWith(fake.client, "p1", revalidate);

  expect("ok", result.ok, true);
  expect("delete was the operation", fake.mode(), "delete");
  expect("never touches papers", fake.calls.some((call) => call.includes("papers")), false);
  expect("project revalidated", revalidated.includes("/project/p1"), true);
}

console.log("\n[6] delete: RLS filtered the row out");

{
  const fake = createFake({ write: { data: null, error: null } });
  const result = await deleteProjectWith(fake.client, "p1", revalidate);
  expect("reports failure", result.ok, false);
}

console.log("\n[7] sharing: an existing slug is returned untouched");

{
  const fake = createFake({ read: { data: { share_slug: "live-slug" }, error: null } });
  const result = await enableSharingWith(fake.client, "p1", revalidate, () => "new-slug");

  expect("ok", result.ok, true);
  expect("same slug", result.slug, "live-slug");
  expect("no update issued", fake.calls.includes("update"), false);
}

console.log("\n[8] sharing: a new slug is written with shared_at");

{
  resetRevalidated();
  const fake = createFake({
    read: { data: { share_slug: null }, error: null },
    write: { data: { share_slug: "generated-slug" }, error: null },
  });
  const result = await enableSharingWith(fake.client, "p1", revalidate, () => "generated-slug");

  expect("ok", result.ok, true);
  expect("slug returned", result.slug, "generated-slug");
  expect("update carried the slug", fake.values()?.share_slug, "generated-slug");
  expect("update carried shared_at", typeof fake.values()?.shared_at, "string");
  expect("project revalidated", revalidated.includes("/project/p1"), true);
}

console.log("\n[9] sharing: the 0002 migration hint survives the refactor");

{
  const fake = createFake({
    read: { data: null, error: { code: "42703", message: "column share_slug does not exist" } },
  });
  const result = await enableSharingWith(fake.client, "p1", revalidate);
  expect("fails", result.ok, false);
  expect("mentions the migration", /0002_sharing\.sql/.test(result.error ?? ""), true);
}

console.log("\n[10] sharing: signed out, and revoking");

{
  const signedOut = createFake({ signedIn: false });
  const denied = await enableSharingWith(signedOut.client, "p1", revalidate);
  expect("enable requires a session", denied.ok, false);
  expect("no table access", signedOut.touchedTable(), false);

  resetRevalidated();
  const fake = createFake({ write: { data: { id: "p1" }, error: null } });
  const result = await disableSharingWith(fake.client, "p1", revalidate);

  expect("disable ok", result.ok, true);
  expect("slug is nulled, not kept dormant", fake.values(), { share_slug: null, shared_at: null });
  expect("project revalidated", revalidated.includes("/project/p1"), true);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll action checks passed.\n");
