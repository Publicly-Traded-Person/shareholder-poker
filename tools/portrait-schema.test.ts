// Guards site/schema.sql against silent loss of the portrait consent tables.
// schema.sql is hand-maintained; these assertions fail loudly if a future
// edit drops a constraint the consent flow depends on (spec 2026-08-26 s5).
import { describe, expect, test } from "bun:test";

const schema = await Bun.file(new URL("../site/schema.sql", import.meta.url)).text();

describe("portrait consent schema", () => {
  test("portrait_asks exists with the enumeration guards", () => {
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS portrait_asks");
    expect(schema).toContain("UNIQUE(handle, set_slug)");
    expect(schema).toContain("expires_at");
  });
  test("portrait_answers is append-only shaped with the CHECK", () => {
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS portrait_answers");
    expect(schema).toContain("CHECK (answer IN ('approved','declined'))");
    expect(schema).toContain("portrait_answers_token_time");
  });
  test("no email column in either portrait table", () => {
    // Column defs start a line with two spaces then the name; comments start
    // with "--" and may mention the word email while explaining the boundary.
    const portraitPart = schema.slice(schema.indexOf("portrait_asks"));
    expect(/\n\s+email\s/.test(portraitPart)).toBe(false);
  });
});
