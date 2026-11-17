import { describe, expect, it } from "vitest";
import {
  acceptJump,
  acresFromM2,
  addFix,
  finishSurvey,
  newSurvey,
  pauseSurvey,
  previewAreaM2,
  removePoint,
  reportGpsError,
  resumeSurvey,
  reviewSurvey,
  selfIntersects,
  startSurvey,
  SurveyNotReady,
  toGeometryInput,
  type Fix,
  type SurveyState,
} from "../apps/field-pwa/lib/walk-survey";

const ids = {
  mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  landId: "06149451-4004-4a23-a5a2-64a24e485a82",
  expectedVersion: 0,
};
const t0 = 1_800_000_000_000;
// A ~110 m square near 8.3 N, 80.2 E walked counter-clockwise at about 1.4 m/s, a fix every 7 s (~10 m).
const corners = [
  [80.2, 8.3],
  [80.201, 8.3],
  [80.201, 8.301],
  [80.2, 8.301],
];
function walk(sides = 4, accuracyM = 5): Fix[] {
  const fixes: Fix[] = [];
  let k = 0;
  for (let s = 0; s < sides; s += 1) {
    const [a, b] = [corners[s], corners[(s + 1) % 4]];
    for (let i = 0; i < 11; i += 1)
      fixes.push({
        longitude: a[0] + ((b[0] - a[0]) * i) / 11,
        latitude: a[1] + ((b[1] - a[1]) * i) / 11,
        accuracyM,
        timestampMs: t0 + 7000 * k++,
      });
  }
  return fixes;
}
const record = (fixes: Fix[], state = startSurvey(newSurvey(), t0)) =>
  fixes.reduce(addFix, state);
const reviewed = (fixes: Fix[]) => finishSurvey(record(fixes), t0 + 10_000_000);

describe("walk survey capture rules", () => {
  it("records nothing unless the officer explicitly started and it is recording", () => {
    const idle = addFix(newSurvey(), walk()[0]);
    expect(idle.points).toHaveLength(0);
    expect(idle.events).toHaveLength(0);
    const started = startSurvey(newSurvey(), t0);
    expect(() => startSurvey(started, t0)).toThrow();
    const paused = pauseSurvey(
      record(walk().slice(0, 3), started),
      t0 + 30_000,
    );
    expect(addFix(paused, walk()[5]).points).toHaveLength(3);
    const done = finishSurvey(paused, t0 + 40_000);
    expect(addFix(done, walk()[5]).points).toHaveLength(3);
  });

  it("never invents points across a pause and does not flag the jump across it", () => {
    const fixes = walk();
    let state = record(fixes.slice(0, 5));
    state = pauseSurvey(state, t0 + 100_000);
    state = resumeSurvey(state, t0 + 500_000);
    // The officer resumes 100 m away after a long break: a different segment, no fabricated path and no jump flag.
    state = addFix(state, { ...fixes[30], timestampMs: t0 + 510_000 });
    expect(state.points).toHaveLength(6);
    expect(state.points[5].segment).toBe(1);
    expect(state.points[5].jumpFlag).toBe(false);
    expect(reviewSurvey(state).segments).toBe(2);
    expect(
      state.events.some((e) => e.type === "jump" || e.type === "gap"),
    ).toBe(false);
  });

  it("rejects poor, unknown, invalid and out-of-order fixes and drops jitter, counting accuracy rejections", () => {
    let state = record(walk().slice(0, 2));
    const base = state.points[1];
    state = addFix(state, {
      ...base,
      accuracyM: 25,
      timestampMs: base.timestampMs + 7000,
    });
    state = addFix(state, {
      ...base,
      accuracyM: null,
      timestampMs: base.timestampMs + 8000,
    });
    state = addFix(state, {
      ...base,
      longitude: 181,
      timestampMs: base.timestampMs + 9000,
    });
    state = addFix(state, {
      ...base,
      accuracyM: 3,
      timestampMs: base.timestampMs - 1,
    });
    state = addFix(state, {
      ...base,
      accuracyM: 3,
      timestampMs: base.timestampMs + 10_000,
    });
    expect(state.points).toHaveLength(2);
    expect(state.rejectedForAccuracy).toBe(2);
    expect(state.events.filter((e) => e.type === "reject")).toHaveLength(4);
    expect(state.events.some((e) => e.type === "duplicate")).toBe(true);
  });

  it("flags an implausible jump and a long silence, and blocks submission until the jump is resolved", () => {
    const fixes = walk();
    let state = record(fixes.slice(0, 5));
    const last = state.points[4];
    state = addFix(state, {
      longitude: last.longitude + 0.002,
      latitude: last.latitude,
      accuracyM: 5,
      timestampMs: last.timestampMs + 7000,
    });
    expect(state.points[5].jumpFlag).toBe(true);
    expect(state.events.some((e) => e.type === "jump")).toBe(true);
    state = addFix(state, {
      longitude: state.points[5].longitude + 0.00001,
      latitude: state.points[5].latitude,
      accuracyM: 5,
      timestampMs: state.points[5].timestampMs + 120_000,
    });
    expect(state.events.some((e) => e.type === "gap")).toBe(true);
    const review = finishSurvey(state, t0 + 1_000_000);
    expect(reviewSurvey(review).flaggedJumps).toBe(1);
    expect(() => toGeometryInput(review, ids)).toThrowError(SurveyNotReady);
    expect(() => acceptJump(review, 5, "  ", t0)).toThrow();
    expect(() => acceptJump(review, 0, "not flagged", t0)).toThrow();
    const accepted = acceptJump(review, 5, "Fence around a pond", t0 + 1);
    expect(reviewSurvey(accepted).flaggedJumps).toBe(0);
    expect(accepted.events.at(-1)).toMatchObject({
      type: "accept_jump",
      reason: "Fence around a pond",
    });
  });

  it("blocks submission for an unresolved jump even when everything else is valid", () => {
    const good = reviewed(walk());
    expect(() => toGeometryInput(good, ids)).not.toThrow();
    const flagged = {
      ...good,
      points: good.points.map((p, i) =>
        i === 3 ? { ...p, jumpFlag: true } : p,
      ),
    };
    try {
      toGeometryInput(flagged, ids);
      expect.unreachable();
    } catch (error) {
      expect((error as SurveyNotReady).reason).toBe("unresolved_jumps");
    }
    expect(() =>
      toGeometryInput(acceptJump(flagged, 3, "Gate", t0), ids),
    ).not.toThrow();
  });

  it("audits manual point removal and requires a reason", () => {
    const state = record(walk().slice(0, 4));
    expect(() => removePoint(state, 1, " ", t0)).toThrow();
    expect(() => removePoint(state, 9, "x", t0)).toThrow();
    expect(() => removePoint(newSurvey(), 0, "x", t0)).toThrow();
    const edited = removePoint(state, 1, " Stood in a doorway ", t0 + 5);
    expect(edited.points).toHaveLength(3);
    expect(edited.events.at(-1)).toEqual({
      type: "remove",
      atMs: t0 + 5,
      index: 1,
      reason: "Stood in a doorway",
    });
  });

  it("keeps the session open after a denied or failed location read so the officer can retry", () => {
    let state = startSurvey(newSurvey(), t0);
    state = reportGpsError(state, t0 + 1, "denied");
    expect(state.status).toBe("recording");
    state = record(walk().slice(0, 2), state);
    expect(state.points).toHaveLength(2);
    expect(state.events.some((e) => e.type === "gps_error")).toBe(true);
    expect(reportGpsError(newSurvey(), t0, "timeout").events).toHaveLength(0);
  });

  it("stops at the point limit the server accepts", () => {
    const state = record(
      walk().slice(0, 6),
      startSurvey(newSurvey({ maxPoints: 3 }), t0),
    );
    expect(state.points).toHaveLength(3);
    expect(state.events.some((e) => e.type === "limit")).toBe(true);
  });
});

describe("review and submission", () => {
  it("builds a closed, validated ring with a plausible preview area and the worst accuracy", () => {
    const state = reviewed(
      walk(4, 5).map((f, i) => (i === 7 ? { ...f, accuracyM: 12 } : f)),
    );
    const review = reviewSurvey(state);
    expect(review.selfIntersects).toBe(false);
    expect(review.closureGapM).toBeLessThan(15);
    expect(review.previewAreaM2).toBeGreaterThan(11500);
    expect(review.previewAreaM2).toBeLessThan(12500);
    const input = toGeometryInput(state, ids);
    expect(input.source).toBe("gps_walk");
    expect(input.accuracyM).toBe(12);
    expect(input.ring[0]).toEqual(input.ring[input.ring.length - 1]);
    expect(input.ring).toHaveLength(45);
  });

  it("refuses a survey that is not in review, too short, open, or self-intersecting", () => {
    expect(() => toGeometryInput(record(walk()), ids)).toThrow(SurveyNotReady);
    expect(() => toGeometryInput(reviewed(walk().slice(0, 2)), ids)).toThrow(
      SurveyNotReady,
    );
    // Three sides only: the last point is ~110 m from the start, so the ring is not closed.
    try {
      toGeometryInput(reviewed(walk(3)), ids);
      expect.unreachable();
    } catch (error) {
      expect((error as SurveyNotReady).reason).toBe("closure_gap");
    }
    const bowTie: Fix[] = [
      [80.2, 8.3],
      [80.201, 8.301],
      [80.201, 8.3],
      [80.2, 8.301],
    ].map(([longitude, latitude], i) => ({
      longitude,
      latitude,
      accuracyM: 5,
      timestampMs: t0 + 100_000 * i,
    }));
    const crossed = reviewed(bowTie);
    expect(reviewSurvey(crossed).selfIntersects).toBe(true);
    try {
      toGeometryInput(crossed, { ...ids });
      expect.unreachable();
    } catch (error) {
      expect((error as SurveyNotReady).reason).toBe("self_intersection");
    }
  });

  it("detects self-intersection only for crossing edges and previews area for a known square", () => {
    const square = corners.map(([longitude, latitude]) => ({
      longitude,
      latitude,
    }));
    expect(selfIntersects(square)).toBe(false);
    expect(selfIntersects([square[0], square[2], square[1], square[3]])).toBe(
      true,
    );
    expect(previewAreaM2(square)).toBeGreaterThan(12000);
    expect(previewAreaM2(square.slice(0, 2))).toBe(0);
  });

  it("never exposes the state's input mutation: operations return new states", () => {
    const state: SurveyState = startSurvey(newSurvey(), t0);
    const after = addFix(state, walk()[0]);
    expect(state.points).toHaveLength(0);
    expect(after.points).toHaveLength(1);
  });

  it("converts square metres to international acres", () => {
    expect(acresFromM2(4046.8564224)).toBeCloseTo(1, 10);
    expect(acresFromM2(0)).toBe(0);
    expect(acresFromM2(12177)).toBeGreaterThan(3);
    expect(acresFromM2(12177)).toBeLessThan(3.02);
  });
});
