import {
  landGeometryRecordSchema,
  type LandGeometryRecord,
} from "@agri/validation";

/**
 * Pure state machine for the "walk the perimeter" survey (P1-11a). It has no clock, storage, network
 * or geolocation access: the caller passes each fix in, so behaviour is deterministic and testable.
 *
 * Rules it enforces:
 * - Nothing is recorded unless the officer explicitly started a session and it is currently recording
 *   (no tracking outside an explicit survey).
 * - Pausing never fabricates points. Time and distance gaps are flagged, never interpolated.
 * - Low-accuracy fixes are rejected and counted, not silently averaged.
 * - Implausible jumps are stored but flagged and must be removed or accepted at review.
 * - Manual removal of a point needs a reason and leaves an audit event.
 * - The area here is a local preview only; the server's PostGIS geodesic area is authoritative, and the
 *   polygon is a provisional identification aid, never a legal survey.
 */
export type Fix = {
  longitude: number;
  latitude: number;
  accuracyM: number | null;
  timestampMs: number;
};
export type SurveyPoint = Fix & {
  /** Increments after every pause/resume so the straight line across a pause is identifiable. */
  segment: number;
  jumpFlag: boolean;
};
export type SurveyEvent =
  | { type: "start" | "pause" | "resume" | "finish"; atMs: number }
  | { type: "reject"; atMs: number; reason: "accuracy" | "order" | "invalid" }
  | { type: "duplicate"; atMs: number }
  | { type: "gap"; atMs: number; seconds: number }
  | { type: "jump"; atMs: number; metres: number; metresPerSecond: number }
  | {
      type: "gps_error";
      atMs: number;
      code: "denied" | "unavailable" | "timeout";
    }
  | { type: "limit"; atMs: number }
  | { type: "remove"; atMs: number; index: number; reason: string }
  | { type: "accept_jump"; atMs: number; index: number; reason: string };
export type SurveyConfig = {
  maxAccuracyM: number;
  maxSpeedMps: number;
  maxGapMs: number;
  minStepM: number;
  maxPoints: number;
  maxClosureGapM: number;
};
export const defaultSurveyConfig: SurveyConfig = {
  maxAccuracyM: 20,
  maxSpeedMps: 5,
  maxGapMs: 30_000,
  minStepM: 1,
  // The server accepts at most 5000 ring points including the closing point.
  maxPoints: 4999,
  maxClosureGapM: 30,
};
export type SurveyState = {
  status: "idle" | "recording" | "paused" | "review";
  points: SurveyPoint[];
  events: SurveyEvent[];
  segment: number;
  rejectedForAccuracy: number;
  config: SurveyConfig;
};
export type SurveyReview = {
  pointCount: number;
  flaggedJumps: number;
  segments: number;
  selfIntersects: boolean;
  closureGapM: number;
  previewAreaM2: number;
  rejectedForAccuracy: number;
};

export function newSurvey(config: Partial<SurveyConfig> = {}): SurveyState {
  return {
    status: "idle",
    points: [],
    events: [],
    segment: 0,
    rejectedForAccuracy: 0,
    config: { ...defaultSurveyConfig, ...config },
  };
}
const withEvent = (state: SurveyState, event: SurveyEvent): SurveyState => ({
  ...state,
  events: [...state.events, event],
});
const R = 6371008.8;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
export function distanceM(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Explicit start by the officer. A session can be started again only from idle or after review is discarded. */
export function startSurvey(state: SurveyState, nowMs: number): SurveyState {
  if (state.status !== "idle") throw new Error("Survey already started");
  return withEvent(
    { ...state, status: "recording" },
    { type: "start", atMs: nowMs },
  );
}
export function pauseSurvey(state: SurveyState, nowMs: number): SurveyState {
  if (state.status !== "recording") return state;
  return withEvent(
    { ...state, status: "paused" },
    { type: "pause", atMs: nowMs },
  );
}
export function resumeSurvey(state: SurveyState, nowMs: number): SurveyState {
  if (state.status !== "paused") return state;
  return withEvent(
    { ...state, status: "recording", segment: state.segment + 1 },
    { type: "resume", atMs: nowMs },
  );
}
export function finishSurvey(state: SurveyState, nowMs: number): SurveyState {
  if (state.status !== "recording" && state.status !== "paused") return state;
  return withEvent(
    { ...state, status: "review" },
    { type: "finish", atMs: nowMs },
  );
}
/** Records a denied/unavailable/timeout geolocation result. The session stays open so the officer can retry. */
export function reportGpsError(
  state: SurveyState,
  nowMs: number,
  code: "denied" | "unavailable" | "timeout",
): SurveyState {
  if (state.status !== "recording") return state;
  return withEvent(state, { type: "gps_error", atMs: nowMs, code });
}

/** Adds one position fix. Fixes are ignored entirely unless the session is recording. */
export function addFix(state: SurveyState, fix: Fix): SurveyState {
  if (state.status !== "recording") return state;
  const { config } = state;
  const valid =
    Number.isFinite(fix.longitude) &&
    Number.isFinite(fix.latitude) &&
    Math.abs(fix.longitude) <= 180 &&
    Math.abs(fix.latitude) <= 90 &&
    Number.isFinite(fix.timestampMs) &&
    (fix.accuracyM === null ||
      (Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0));
  if (!valid)
    return withEvent(state, {
      type: "reject",
      atMs: fix.timestampMs,
      reason: "invalid",
    });
  // Unknown accuracy cannot be trusted for a boundary, so it is rejected like a poor fix.
  if (fix.accuracyM === null || fix.accuracyM > config.maxAccuracyM)
    return withEvent(
      { ...state, rejectedForAccuracy: state.rejectedForAccuracy + 1 },
      { type: "reject", atMs: fix.timestampMs, reason: "accuracy" },
    );
  const last = state.points[state.points.length - 1];
  if (last && fix.timestampMs <= last.timestampMs)
    return withEvent(state, {
      type: "reject",
      atMs: fix.timestampMs,
      reason: "order",
    });
  if (state.points.length >= config.maxPoints)
    return withEvent(state, { type: "limit", atMs: fix.timestampMs });
  let next = state;
  let jumpFlag = false;
  const sameSegment = last !== undefined && last.segment === state.segment;
  if (last) {
    const metres = distanceM(last, fix);
    if (metres < config.minStepM && sameSegment)
      return withEvent(state, { type: "duplicate", atMs: fix.timestampMs });
    if (sameSegment) {
      const dt = fix.timestampMs - last.timestampMs;
      if (dt > config.maxGapMs)
        next = withEvent(next, {
          type: "gap",
          atMs: fix.timestampMs,
          seconds: Math.round(dt / 1000),
        });
      const speed = metres / (dt / 1000);
      if (speed > config.maxSpeedMps) {
        jumpFlag = true;
        next = withEvent(next, {
          type: "jump",
          atMs: fix.timestampMs,
          metres: Math.round(metres),
          metresPerSecond: Math.round(speed * 10) / 10,
        });
      }
    }
  }
  return {
    ...next,
    points: [...next.points, { ...fix, segment: state.segment, jumpFlag }],
  };
}

/** Manual correction: needs a reason and leaves an audit event. Allowed while recording, paused or in review. */
export function removePoint(
  state: SurveyState,
  index: number,
  reason: string,
  nowMs: number,
): SurveyState {
  if (state.status === "idle") throw new Error("No survey to edit");
  if (!Number.isInteger(index) || index < 0 || index >= state.points.length)
    throw new Error("Unknown point");
  if (!reason.trim()) throw new Error("A reason is required");
  return withEvent(
    { ...state, points: state.points.filter((_, i) => i !== index) },
    { type: "remove", atMs: nowMs, index, reason: reason.trim() },
  );
}
/** Accepts a flagged jump as real (for example a fence line around a pond), with a recorded reason. */
export function acceptJump(
  state: SurveyState,
  index: number,
  reason: string,
  nowMs: number,
): SurveyState {
  const point = state.points[index];
  if (!point?.jumpFlag) throw new Error("Point is not flagged");
  if (!reason.trim()) throw new Error("A reason is required");
  return withEvent(
    {
      ...state,
      points: state.points.map((p, i) =>
        i === index ? { ...p, jumpFlag: false } : p,
      ),
    },
    { type: "accept_jump", atMs: nowMs, index, reason: reason.trim() },
  );
}

function localMetres(points: { longitude: number; latitude: number }[]) {
  const lat0 = points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
  const lon0 = points.reduce((sum, p) => sum + p.longitude, 0) / points.length;
  return points.map((p) => ({
    x: rad(p.longitude - lon0) * R * Math.cos(rad(lat0)),
    y: rad(p.latitude - lat0) * R,
  }));
}
const cross = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) {
  const d1 = cross(a, b, c),
    d2 = cross(a, b, d),
    d3 = cross(c, d, a),
    d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
/** True when any two non-adjacent edges of the closed ring cross. Touching collinear cases are left to the server. */
export function selfIntersects(
  points: { longitude: number; latitude: number }[],
) {
  const n = points.length;
  if (n < 4) return false;
  const p = localMetres(points);
  for (let i = 0; i < n; i += 1) {
    const a = p[i],
      b = p[(i + 1) % n];
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      const c = p[j],
        d = p[(j + 1) % n];
      if (
        Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
        Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
        Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
        Math.max(c.y, d.y) < Math.min(a.y, b.y)
      )
        continue;
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}
/** Spherical-excess area in square metres for a ring (open or closed). A preview only; PostGIS decides. */
export function previewAreaM2(
  points: { longitude: number; latitude: number }[],
) {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i],
      b = points[(i + 1) % n];
    sum +=
      rad(b.longitude - a.longitude) *
      (2 + Math.sin(rad(a.latitude)) + Math.sin(rad(b.latitude)));
  }
  return Math.abs((sum * R * R) / 2);
}
/** One international acre in square metres (the canonical unit is m²; acres and hectares are display units). */
export const squareMetresPerAcre = 4046.8564224;
export const acresFromM2 = (squareMetres: number) =>
  squareMetres / squareMetresPerAcre;
export function reviewSurvey(state: SurveyState): SurveyReview {
  const { points } = state;
  return {
    pointCount: points.length,
    flaggedJumps: points.filter((p) => p.jumpFlag).length,
    segments: new Set(points.map((p) => p.segment)).size,
    selfIntersects: selfIntersects(points),
    closureGapM:
      points.length > 1 ? distanceM(points[points.length - 1], points[0]) : 0,
    previewAreaM2: previewAreaM2(points),
    rejectedForAccuracy: state.rejectedForAccuracy,
  };
}

export class SurveyNotReady extends Error {
  constructor(
    readonly reason:
      | "not_in_review"
      | "too_few_points"
      | "unresolved_jumps"
      | "self_intersection"
      | "closure_gap",
  ) {
    super(reason);
  }
}
/**
 * Builds the strictly validated input for `PilotClient.recordLandGeometry`. The ring is closed by repeating
 * the first point; the server never edits submitted coordinates. Refuses a survey that is not ready.
 */
export function toGeometryInput(
  state: SurveyState,
  ids: { mutationId: string; landId: string; expectedVersion: number },
): LandGeometryRecord {
  if (state.status !== "review") throw new SurveyNotReady("not_in_review");
  const review = reviewSurvey(state);
  if (review.pointCount < 3) throw new SurveyNotReady("too_few_points");
  if (review.flaggedJumps > 0) throw new SurveyNotReady("unresolved_jumps");
  if (review.selfIntersects) throw new SurveyNotReady("self_intersection");
  if (review.closureGapM > state.config.maxClosureGapM)
    throw new SurveyNotReady("closure_gap");
  const ring = state.points.map((p) => [p.longitude, p.latitude]);
  ring.push([...ring[0]]);
  // Conservative accuracy: the worst fix used, so the polygon never claims better than its weakest point.
  const accuracyM = Math.max(...state.points.map((p) => p.accuracyM ?? 0));
  return landGeometryRecordSchema.parse({
    ...ids,
    ring,
    source: "gps_walk",
    accuracyM,
  });
}
