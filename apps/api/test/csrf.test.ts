// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CsrfTokens } from "../src/authentication/csrf";
const csrf = new CsrfTokens(Buffer.alloc(32, 7), [
  "https://admin.example.test",
]);
describe("session-bound CSRF tokens", () => {
  it("accepts the correct origin, session and token", () => {
    const token = csrf.issue("synthetic-session");
    expect(() =>
      csrf.assertValid(
        "synthetic-session",
        "https://admin.example.test",
        token,
      ),
    ).not.toThrow();
  });
  it("rejects a different origin, session, missing or modified token", () => {
    const token = csrf.issue("synthetic-session");
    for (const [session, origin, supplied] of [
      ["other", "https://admin.example.test", token],
      ["synthetic-session", "https://attacker.example.test", token],
      ["synthetic-session", undefined, token],
      ["synthetic-session", "https://admin.example.test", undefined],
      [
        "synthetic-session",
        "https://admin.example.test",
        `${token.slice(0, -1)}!`,
      ],
    ] as const) {
      expect(() => csrf.assertValid(session, origin, supplied)).toThrow(
        "CSRF validation failed",
      );
    }
  });
  it("rejects weak keys and inexact origins", () => {
    expect(
      () => new CsrfTokens(Buffer.alloc(16), ["https://example.test"]),
    ).toThrow();
    expect(
      () => new CsrfTokens(Buffer.alloc(32), ["https://example.test/path"]),
    ).toThrow();
    expect(
      () => new CsrfTokens(Buffer.alloc(32), ["http://example.test"]),
    ).toThrow();
  });
});
