import { describe, expect, it } from "vitest";
import {
  landGeometryQuerySchema,
  landGeometryRecordSchema,
} from "../packages/validation/src";

const id = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const ring = [
  [80.2, 8.3],
  [80.201, 8.3],
  [80.201, 8.301],
  [80.2, 8.3],
];
const valid = {
  mutationId: id,
  landId: id,
  expectedVersion: 0,
  ring,
  source: "gps_walk",
};

describe("land geometry input contract", () => {
  it("accepts a closed ring and defaults accuracy to null", () => {
    expect(landGeometryRecordSchema.parse(valid).accuracyM).toBeNull();
  });
  it.each([
    ["official_survey source", { source: "official_survey" }],
    ["unknown field", { verified: true }],
    ["unclosed ring", { ring: ring.slice(0, 3) }],
    ["too few points", { ring: [ring[0], ring[1], ring[0]] }],
    ["out-of-range longitude", { ring: [[181, 0], ...ring.slice(1)] }],
    ["NaN coordinate", { ring: [[Number.NaN, 0], ...ring.slice(1)] }],
    ["negative expected version", { expectedVersion: -1 }],
    ["negative accuracy", { accuracyM: -1 }],
    ["non-uuid land", { landId: "x" }],
  ])("rejects %s", (_name, extra) => {
    expect(() =>
      landGeometryRecordSchema.parse({ ...valid, ...extra }),
    ).toThrow();
  });
  it("parses the history flag explicitly, never by truthiness", () => {
    expect(landGeometryQuerySchema.parse({ landId: id }).history).toBe(false);
    expect(
      landGeometryQuerySchema.parse({ landId: id, history: "false" }).history,
    ).toBe(false);
    expect(
      landGeometryQuerySchema.parse({ landId: id, history: "true" }).history,
    ).toBe(true);
    expect(() =>
      landGeometryQuerySchema.parse({ landId: id, history: "0" }),
    ).toThrow();
  });
});
