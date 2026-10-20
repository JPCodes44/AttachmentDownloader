import { afterEach, describe, expect, test } from "bun:test";
import { decrypt, encrypt } from "../convex/crypto";
import { getMessage, gmailGet, mapLimit } from "../convex/gmailApi";
import { matchesExtensions, withAttachmentFilter } from "../convex/scans";
import { base64UrlToBytes } from "../src/lib/download";
import { sanitizeFilename, uniqueFilenames } from "../src/lib/filenames";
import { buildQuery, EMPTY_FILTERS } from "../src/lib/gmailQuery";

describe("buildQuery", () => {
  test("empty filters still require attachments", () => {
    expect(buildQuery(EMPTY_FILTERS)).toBe("has:attachment");
  });

  test("combines every filter in Gmail syntax", () => {
    expect(
      buildQuery({
        text: "invoice",
        from: "Bob Smith",
        after: "2026-01-01",
        before: "2026-06-30",
        label: "Work Stuff",
        fileTypes: ["pdf", "sheets"],
        largerThanMb: "2",
      }),
    ).toBe(
      'invoice from:"Bob Smith" after:2026/01/01 before:2026/06/30 label:Work-Stuff ' +
        "{filename:pdf filename:xls filename:xlsx filename:csv filename:ods} larger:2M has:attachment",
    );
  });

  test("single extension needs no braces", () => {
    expect(buildQuery({ ...EMPTY_FILTERS, fileTypes: ["pdf"] })).toBe("filename:pdf has:attachment");
  });
});

describe("filenames", () => {
  test("sanitize strips path and illegal characters", () => {
    expect(sanitizeFilename('../a/b:c*?"d<>|.pdf')).toBe("_a_b_c___d___.pdf");
    expect(sanitizeFilename("   ")).toBe("attachment");
  });

  test("dedupes case-insensitively, keeping the extension", () => {
    expect(uniqueFilenames(["a.pdf", "A.pdf", "a.pdf", "noext", "noext", "a (2).pdf"])).toEqual([
      "a.pdf",
      "A (2).pdf",
      "a (3).pdf",
      "noext",
      "noext (2)",
      "a (2) (2).pdf",
    ]);
  });
});

describe("scan helpers", () => {
  test("withAttachmentFilter adds has:attachment once", () => {
    expect(withAttachmentFilter("from:bob")).toBe("from:bob has:attachment");
    expect(withAttachmentFilter("has:attachment from:bob")).toBe("has:attachment from:bob");
    expect(withAttachmentFilter("  ")).toBe("has:attachment");
    expect(withAttachmentFilter("has:attachment OR in:anywhere")).toBe("(has:attachment OR in:anywhere) has:attachment");
    expect(withAttachmentFilter("{has:attachment in:anywhere}")).toBe("({has:attachment in:anywhere}) has:attachment");
  });

  test("matchesExtensions", () => {
    expect(matchesExtensions("x.PDF", ["pdf"])).toBe(true);
    expect(matchesExtensions("x.png", ["pdf"])).toBe(false);
    expect(matchesExtensions("x.png", [])).toBe(true);
  });

  test("mapLimit keeps order and caps concurrency", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await Bun.sleep(n);
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});

describe("crypto and encoding", () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

  test("encrypt/decrypt round trip with random IVs", async () => {
    const a = await encrypt("1//refresh-token", key);
    const b = await encrypt("1//refresh-token", key);
    expect(a).not.toBe(b);
    expect(await decrypt(a, key)).toBe("1//refresh-token");
  });

  test("rejects a wrong-length key", async () => {
    await expect(encrypt("x", btoa("short"))).rejects.toThrow("32 bytes");
  });

  test("base64url decoding", () => {
    // "hi?>" encodes to "aGk_Pg" in base64url
    expect(new TextDecoder().decode(base64UrlToBytes("aGk_Pg"))).toBe("hi?>");
  });
});

describe("Gmail API retries", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // Each call takes the next scripted response; an Error is thrown like a network failure.
  function script(...responses: (Response | Error)[]) {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch;
    return calls;
  }

  test("a message deleted mid-scan is skipped, not fatal", async () => {
    script(new Response("{}", { status: 404 }));
    expect(await getMessage("token", "gone")).toBeNull();
  });

  test("network errors and per-user rate limits are retried", async () => {
    const calls = script(
      new TypeError("fetch failed"),
      new Response('{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}', { status: 403 }),
      Response.json({ ok: true }),
    );
    expect(await gmailGet("token", "/labels")).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  }, 10_000);

  test("other 403s fail straight away", async () => {
    const calls = script(new Response('{"error":{"errors":[{"reason":"insufficientPermissions"}]}}', { status: 403 }));
    await expect(gmailGet("token", "/labels")).rejects.toThrow("403");
    expect(calls).toHaveLength(1);
  });
});
