"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LandGeometryRecord } from "@agri/validation";
import {
  acceptJump,
  acresFromM2,
  addFix,
  finishSurvey,
  newSurvey,
  pauseSurvey,
  removePoint,
  reportGpsError,
  resumeSurvey,
  reviewSurvey,
  startSurvey,
  SurveyNotReady,
  toGeometryInput,
  type SurveyState,
} from "../lib/walk-survey";

type Language = "en" | "si";
type GeolocationLike = Pick<Geolocation, "watchPosition" | "clearWatch">;
type GeometryClient = {
  recordLandGeometry(
    accountId: string,
    input: LandGeometryRecord,
  ): Promise<{ version: number; replayed: boolean; calculatedAreaM2: number }>;
};

const words = {
  en: {
    title: "Walk the land perimeter",
    intro:
      "Walk the whole boundary with this screen open and visible. Points are recorded only while you are recording. Keep the screen on: browsers may stop location updates in the background, and this app will pause if the page is hidden.",
    provisional:
      "The result is a provisional polygon to identify the land. It is not a legal survey or verified acreage.",
    start: "Start recording",
    pause: "Pause",
    resume: "Resume",
    finish: "Finish and review",
    discard: "Discard survey",
    recording: "Recording",
    paused: "Paused",
    review: "Review",
    points: "Points recorded",
    accuracy: "Latest accuracy",
    meters: "m",
    acres: "acres",
    good: "good",
    poor: "too weak, ignored",
    noFix: "waiting for a location",
    rejected: "Weak or invalid readings ignored",
    jump: "Large jump between points",
    gap: "Long pause in location updates",
    denied:
      "Location permission was denied. Allow location for this site in the browser settings, then try again.",
    unavailable: "Location is unavailable on this device right now.",
    timeout: "Location timed out. Move to open sky and try again.",
    retry: "Try location again",
    unsupported: "This browser cannot provide location.",
    hidden:
      "The page was hidden, so recording was paused. Resume when the screen is visible again.",
    summary: "Survey summary",
    area: "Approximate area (preview; the server calculates the saved area)",
    closure: "Gap between the last and first point",
    flagged: "Unresolved large jumps",
    crossing: "The outline crosses itself",
    segments: "Recording segments (pauses add a straight line)",
    remove: "Remove point",
    reason: "Reason (required)",
    accept: "Accept this jump",
    submit: "Save provisional polygon",
    saving: "Saving…",
    signedOutLock:
      "You are signed out. The survey is kept in this device's memory but hidden, and recording is paused. Sign in again as the same account on the same approved device to continue; signing in as another account removes it.",
    retrySame: "Retry the same save",
    unknownOutcome:
      "We could not confirm whether the server saved this polygon. Retrying sends exactly the same save, which is safe to repeat. Editing stays locked until the result is known.",
    locked: "Editing is locked while a save is pending or unconfirmed.",
    correct: "Correct the survey and save again",
    discardUnsure: "Discard (an earlier save may already be recorded)",
    saved: "Saved on the server as a provisional polygon.",
    replayed: "This save was already recorded.",
    version: "Version",
    notReady: {
      not_in_review: "Finish the survey first.",
      too_few_points: "At least three good points are needed.",
      unresolved_jumps:
        "Remove or accept each large jump (with a reason) before saving.",
      self_intersection: "Remove points so the outline does not cross itself.",
      closure_gap:
        "The last point is too far from the first. Walk back to the start point, or remove the far points.",
    },
    authError: "Sign in again to save. The survey on this screen is kept.",
    deniedSave:
      "Saving was denied. Contact your administrator about land geometry permission.",
    conflict:
      "This land's polygon changed. Reload the land before saving; nothing was overwritten.",
    invalid: "The server rejected this outline. Check it and try again.",
    failure: "The request could not be completed. Try again.",
  },
  si: {
    title: "ඉඩමේ මායිම ඇවිද මැනීම",
    intro:
      "මෙම තිරය විවෘතව සහ දිස්වන ලෙස තබාගෙන මුළු මායිමම ඇවිදින්න. වාර්තා කරන විට පමණක් ලක්ෂ්‍ය සටහන් වේ. තිරය ක්‍රියාත්මකව තබන්න: පසුබිමේදී බ්‍රවුසර ස්ථාන යාවත්කාලීන නතර කළ හැක; පිටුව සැඟවුණහොත් මෙම යෙදුම විරාම කරයි.",
    provisional:
      "ප්‍රතිඵලය ඉඩම හඳුනාගැනීමට භාවිත කරන තාවකාලික බහුඅස්‍රයකි. එය නීතිමය මැනුමක් හෝ තහවුරු කළ අක්කර ප්‍රමාණයක් නොවේ.",
    start: "වාර්තා කිරීම අරඹන්න",
    pause: "විරාම කරන්න",
    resume: "නැවත අරඹන්න",
    finish: "අවසන් කර සමාලෝචනය කරන්න",
    discard: "මැනුම ඉවත දමන්න",
    recording: "වාර්තා කරමින්",
    paused: "විරාමයේ",
    review: "සමාලෝචනය",
    points: "වාර්තා කළ ලක්ෂ්‍ය",
    accuracy: "අවසන් නිරවද්‍යතාව",
    meters: "මී",
    acres: "අක්කර",
    good: "හොඳයි",
    poor: "දුර්වලයි, නොසලකා හැරියා",
    noFix: "ස්ථානයක් බලාපොරොත්තුවෙන්",
    rejected: "නොසලකා හැරි දුර්වල හෝ වලංගු නොවන කියවීම්",
    jump: "ලක්ෂ්‍ය අතර විශාල පැනීමක්",
    gap: "ස්ථාන යාවත්කාලීන දිගු වේලාවක් නැත",
    denied:
      "ස්ථාන අවසරය ප්‍රතික්ෂේප විය. බ්‍රවුසර සැකසුම් තුළ මෙම අඩවියට ස්ථානය ඉඩ දී නැවත උත්සාහ කරන්න.",
    unavailable: "මෙම උපාංගයේ ස්ථානය දැනට ලබාගත නොහැක.",
    timeout: "ස්ථානය ලබාගැනීම කල් ඉකුත් විය. විවෘත අහස යටට ගොස් නැවත උත්සාහ කරන්න.",
    retry: "ස්ථානය නැවත උත්සාහ කරන්න",
    unsupported: "මෙම බ්‍රවුසරයට ස්ථානය ලබාදිය නොහැක.",
    hidden: "පිටුව සැඟවුණු නිසා වාර්තා කිරීම විරාම කළා. තිරය නැවත දිස්වූ විට නැවත අරඹන්න.",
    summary: "මැනුම් සාරාංශය",
    area: "ආසන්න වර්ගඵලය (පෙරදසුන; සුරකින වර්ගඵලය සේවාදායකය ගණනය කරයි)",
    closure: "අවසන් සහ පළමු ලක්ෂ්‍ය අතර පරතරය",
    flagged: "විසඳා නැති විශාල පැනීම්",
    crossing: "රූපරේඛාව තමාම හරහා යයි",
    segments: "වාර්තා කළ කොටස් (විරාම සරල රේඛාවක් එක් කරයි)",
    remove: "ලක්ෂ්‍යය ඉවත් කරන්න",
    reason: "හේතුව (අවශ්‍යයි)",
    accept: "මෙම පැනීම පිළිගන්න",
    submit: "තාවකාලික බහුඅස්‍රය සුරකින්න",
    saving: "සුරකිමින්…",
    signedOutLock:
      "ඔබ වරන ලදී. මැනුම මෙම උපාංගයේ මතකයේ රැඳී ඇති නමුත් සඟවා ඇති අතර වාර්තා කිරීම විරාම කර ඇත. ඉදිරියට යාමට අනුමත එම උපාංගයෙන් එම ගිණුමෙන්ම නැවත පුරන්න; වෙනත් ගිණුමකින් පුරනය වීමෙන් එය ඉවත් වේ.",
    retrySame: "එම සුරැකීමම නැවත යවන්න",
    unknownOutcome:
      "සේවාදායකය මෙම බහුඅස්‍රය සුරැකුවාදැයි තහවුරු කළ නොහැකි විය. නැවත යැවීමෙන් හරියටම එම සුරැකීමම යැවේ; එය නැවත කිරීම ආරක්ෂිතයි. ප්‍රතිඵලය දැනගන්නා තුරු සංස්කරණය අගුළු දමා ඇත.",
    locked: "සුරැකීමක් පොරොත්තුවේ හෝ තහවුරු නොවී ඇති විට සංස්කරණය අගුළු දමා ඇත.",
    correct: "මැනුම නිවැරදි කර නැවත සුරකින්න",
    discardUnsure: "ඉවත දමන්න (කලින් සුරැකීම දැනටමත් වාර්තා වී තිබිය හැක)",
    saved: "සේවාදායකයේ තාවකාලික බහුඅස්‍රයක් ලෙස සුරැකිණි.",
    replayed: "මෙම සුරැකීම දැනටමත් වාර්තා වී ඇත.",
    version: "අනුවාදය",
    notReady: {
      not_in_review: "පළමුව මැනුම අවසන් කරන්න.",
      too_few_points: "හොඳ ලක්ෂ්‍ය අවම වශයෙන් තුනක් අවශ්‍යයි.",
      unresolved_jumps:
        "සුරැකීමට පෙර සෑම විශාල පැනීමක්ම ඉවත් කරන්න හෝ හේතුවක් සහිතව පිළිගන්න.",
      self_intersection: "රූපරේඛාව තමාම හරහා නොයන සේ ලක්ෂ්‍ය ඉවත් කරන්න.",
      closure_gap:
        "අවසන් ලක්ෂ්‍යය පළමු ලක්ෂ්‍යයෙන් දුරයි. ආරම්භක ලක්ෂ්‍යයට ආපසු ඇවිදින්න, නැතහොත් දුර ලක්ෂ්‍ය ඉවත් කරන්න.",
    },
    authError: "සුරැකීමට නැවත පුරන්න. මෙම තිරයේ ඇති මැනුම රැඳී පවතී.",
    deniedSave: "සුරැකීම ප්‍රතික්ෂේප විය. ඉඩම් ජ්‍යාමිතික අවසරය ගැන පරිපාලක අමතන්න.",
    conflict:
      "මෙම ඉඩමේ බහුඅස්‍රය වෙනස් වී ඇත. සුරැකීමට පෙර ඉඩම නැවත පූරණය කරන්න; කිසිවක් උඩින් ලියවී නැත.",
    invalid: "සේවාදායකය මෙම රූපරේඛාව ප්‍රතික්ෂේප කළා. පරීක්ෂා කර නැවත උත්සාහ කරන්න.",
    failure: "ඉල්ලීම සම්පූර්ණ කළ නොහැකි විය. නැවත උත්සාහ කරන්න.",
  },
};

export function WalkSurveyScreen({
  language,
  accountId,
  landId,
  expectedVersion,
  client,
  geolocation,
  newId = () => crypto.randomUUID(),
  clock = () => Date.now(),
  onActivityChange,
  onBusyChange,
  locked: signedOut = false,
}: {
  language: Language;
  accountId: string;
  landId: string;
  expectedVersion: number;
  client: GeometryClient;
  geolocation?: GeolocationLike | null;
  newId?: () => string;
  clock?: () => number;
  /** True while a survey is recording, paused or in review, so a host page never discards unsaved work on a timeout. */
  onActivityChange?: (active: boolean) => void;
  /** True while a save is in flight or its outcome is unknown, so a host page does not switch land or leave. */
  onBusyChange?: (busy: boolean) => void;
  /** Signed out or session lost: keep the unsaved survey in memory but render nothing sensitive and stop recording. */
  locked?: boolean;
}) {
  const w = words[language];
  const geo =
    geolocation === undefined
      ? typeof navigator === "undefined"
        ? null
        : (navigator.geolocation ?? null)
      : geolocation;
  const [survey, setSurvey] = useState<SurveyState>(() => newSurvey());
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{
    kind: "saved" | "error";
    text: string;
  } | null>(null);
  // idle: editable. saving: request in flight. unknown: outcome not confirmed, same request may be retried.
  // refused: the server definitively refused (400/403); needs an explicit correction. conflict: stale version.
  // saved: done. Editing is locked in every state except idle.
  const [phase, setPhase] = useState<
    "idle" | "saving" | "unknown" | "refused" | "conflict" | "saved"
  >("idle");
  const saving = phase === "saving";
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const watchId = useRef<number | null>(null);
  // The exact request of the first save attempt (mutation id, land, version, ring, source, accuracy).
  // Every retry resends this object unchanged; a new id is created only after an explicit correction.
  const attempt = useRef<Readonly<LandGeometryRecord> | null>(null);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null && geo) geo.clearWatch(watchId.current);
    watchId.current = null;
  }, [geo]);
  const startWatch = useCallback(() => {
    if (!geo) return;
    stopWatch();
    watchId.current = geo.watchPosition(
      (position) =>
        setSurvey((s) =>
          addFix(s, {
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            accuracyM: position.coords.accuracy,
            timestampMs: position.timestamp,
          }),
        ),
      (error) =>
        setSurvey((s) =>
          reportGpsError(
            s,
            clock(),
            error.code === 1
              ? "denied"
              : error.code === 3
                ? "timeout"
                : "unavailable",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }, [geo, stopWatch, clock]);

  // Location is watched only while recording; every other state releases it.
  useEffect(() => {
    if (survey.status !== "recording") stopWatch();
  }, [survey.status, stopWatch]);
  useEffect(() => stopWatch, [stopWatch]);
  // A hidden page cannot be trusted to deliver points, so pause visibly instead of leaving a silent hole.
  const statusRef = useRef(survey.status);
  statusRef.current = survey.status;
  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === "hidden" &&
        statusRef.current === "recording"
      ) {
        setNotice(w.hidden);
        setSurvey((s) => pauseSurvey(s, clock()));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clock, w.hidden]);

  const activity = useRef(onActivityChange);
  activity.current = onActivityChange;
  useEffect(() => {
    activity.current?.(survey.status !== "idle");
  }, [survey.status]);
  useEffect(() => () => activity.current?.(false), []);

  // Losing the session never discards the walk, but it stops recording and releases location at once.
  useEffect(() => {
    if (!signedOut) return;
    // Pausing also releases location through the status effect above.
    setSurvey((s) => pauseSurvey(s, clock()));
    setNotice(null);
  }, [signedOut, clock]);

  const review = useMemo(() => reviewSurvey(survey), [survey]);
  const last = survey.points[survey.points.length - 1];
  const lastGpsError = [...survey.events]
    .reverse()
    .find((event) => event.type === "gps_error");
  const count = (type: string) =>
    survey.events.filter((event) => event.type === type).length;

  function begin() {
    setNotice(null);
    setResult(null);
    attempt.current = null;
    setPhase("idle");
    setSurvey((s) => startSurvey(s, clock()));
    startWatch();
  }
  function resume() {
    setNotice(null);
    setSurvey((s) => resumeSurvey(s, clock()));
    startWatch();
  }
  function discard() {
    stopWatch();
    attempt.current = null;
    setPhase("idle");
    setNotice(null);
    setResult(null);
    setReasons({});
    setSurvey(newSurvey());
  }
  let notReady: SurveyNotReady["reason"] | null = null;
  if (survey.status === "review") {
    try {
      toGeometryInput(survey, {
        mutationId: "00000000-0000-4000-8000-000000000000",
        landId,
        expectedVersion,
      });
    } catch (error) {
      if (error instanceof SurveyNotReady) notReady = error.reason;
      else throw error;
    }
  }
  async function save() {
    if (phase === "saving" || phase === "saved" || survey.status !== "review")
      return;
    if (phase === "refused" || phase === "conflict") return;
    // First attempt: freeze the request. Retries after an unknown outcome reuse it byte for byte.
    if (!attempt.current) {
      const built = toGeometryInput(survey, {
        mutationId: newId(),
        landId,
        expectedVersion,
      });
      attempt.current = Object.freeze(JSON.parse(JSON.stringify(built)));
    }
    const request = attempt.current as LandGeometryRecord;
    setPhase("saving");
    setResult(null);
    try {
      const saved = await client.recordLandGeometry(accountId, request);
      setPhase("saved");
      setResult({
        kind: "saved",
        text: `${w.saved} ${w.version} ${saved.version}.${saved.replayed ? ` ${w.replayed}` : ""}`,
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        // Rejected before it reached the database, so nothing can have been saved: safe to start over.
        attempt.current = null;
        setPhase("idle");
        setResult({ kind: "error", text: w.authError });
      } else if (status === 409) {
        setPhase("conflict");
        setResult({ kind: "error", text: w.conflict });
      } else if (status === 400 || status === 403) {
        setPhase("refused");
        setResult({
          kind: "error",
          text: status === 403 ? w.deniedSave : w.invalid,
        });
      } else {
        // Timeout, network loss, 5xx or an unreadable answer: the server may or may not have committed.
        setPhase("unknown");
        setResult({ kind: "error", text: w.unknownOutcome });
      }
    }
  }
  /** Explicit user action after a definitive refusal: the next save is a new request with a new id. */
  function correctAndRetry() {
    attempt.current = null;
    setResult(null);
    setPhase("idle");
  }
  const locked = phase !== "idle";
  const busy = phase === "saving" || phase === "unknown";
  const notifyBusy = useRef(onBusyChange);
  notifyBusy.current = onBusyChange;
  useEffect(() => {
    notifyBusy.current?.(busy);
  }, [busy]);
  useEffect(() => () => notifyBusy.current?.(false), []);

  const accuracyText =
    last === undefined
      ? w.noFix
      : `${Math.round(last.accuracyM ?? 0)} ${w.meters} (${w.good})`;
  const rejectedCount = survey.rejectedForAccuracy;
  const state =
    survey.status === "recording"
      ? w.recording
      : survey.status === "paused"
        ? w.paused
        : survey.status === "review"
          ? w.review
          : "";
  const big = { minHeight: 48, minWidth: 48 };

  if (signedOut)
    return (
      <section aria-labelledby="walk-title">
        <h2 id="walk-title">{w.title}</h2>
        <p role="alert">{w.signedOutLock}</p>
      </section>
    );

  return (
    <section aria-labelledby="walk-title">
      <h2 id="walk-title">{w.title}</h2>
      {survey.status === "idle" && (
        <>
          <p>{w.intro}</p>
          <p>{w.provisional}</p>
          {!geo && <p role="alert">{w.unsupported}</p>}
          <button style={big} onClick={begin} disabled={!geo}>
            {w.start}
          </button>
        </>
      )}
      {survey.status !== "idle" && (
        <p role="status" aria-live="polite">
          <strong>{state}</strong> — {w.points}: {survey.points.length}
          {survey.status !== "review" && (
            <>
              {" "}
              • {w.accuracy}: {accuracyText}
            </>
          )}
        </p>
      )}
      {notice && <p role="alert">{notice}</p>}
      {lastGpsError?.type === "gps_error" && survey.status === "recording" && (
        <p role="alert">
          {lastGpsError.code === "denied"
            ? w.denied
            : lastGpsError.code === "timeout"
              ? w.timeout
              : w.unavailable}{" "}
          <button style={big} onClick={startWatch}>
            {w.retry}
          </button>
        </p>
      )}
      {survey.status !== "idle" && (
        <ul aria-label={w.summary}>
          {rejectedCount > 0 && (
            <li>
              {w.rejected}: {rejectedCount} ({w.poor})
            </li>
          )}
          {count("jump") > 0 && (
            <li>
              {w.jump}: {count("jump")}
            </li>
          )}
          {count("gap") > 0 && (
            <li>
              {w.gap}: {count("gap")}
            </li>
          )}
        </ul>
      )}
      {survey.status === "recording" && (
        <div className="agri-row">
          <button
            style={big}
            onClick={() => setSurvey((s) => pauseSurvey(s, clock()))}
          >
            {w.pause}
          </button>
          <button
            style={big}
            onClick={() => setSurvey((s) => finishSurvey(s, clock()))}
          >
            {w.finish}
          </button>
        </div>
      )}
      {survey.status === "paused" && (
        <div className="agri-row">
          <button style={big} onClick={resume}>
            {w.resume}
          </button>
          <button
            style={big}
            onClick={() => setSurvey((s) => finishSurvey(s, clock()))}
          >
            {w.finish}
          </button>
        </div>
      )}
      {survey.status === "review" && (
        <>
          <dl>
            <dt>{w.area}</dt>
            <dd>
              {Math.round(review.previewAreaM2).toLocaleString("en")} m² (
              {(review.previewAreaM2 / 10000).toFixed(3)} ha,{" "}
              {acresFromM2(review.previewAreaM2).toFixed(3)} {w.acres})
            </dd>
            <dt>{w.closure}</dt>
            <dd>
              {Math.round(review.closureGapM)} {w.meters}
            </dd>
            <dt>{w.segments}</dt>
            <dd>{review.segments}</dd>
            <dt>{w.flagged}</dt>
            <dd>{review.flaggedJumps}</dd>
          </dl>
          {review.selfIntersects && <p role="alert">{w.crossing}</p>}
          <ol aria-label={w.points}>
            {survey.points.map((point, index) => (
              <li key={`${point.timestampMs}-${index}`}>
                {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)} (±
                {Math.round(point.accuracyM ?? 0)} {w.meters})
                {point.jumpFlag && <strong> — {w.jump}</strong>}
                <div>
                  <label>
                    {w.reason}
                    <input
                      disabled={locked}
                      value={reasons[index] ?? ""}
                      onChange={(event) =>
                        setReasons({ ...reasons, [index]: event.target.value })
                      }
                    />
                  </label>
                  <button
                    style={big}
                    disabled={locked || !(reasons[index] ?? "").trim()}
                    onClick={() => {
                      setSurvey((s) =>
                        removePoint(s, index, reasons[index] ?? "", clock()),
                      );
                      setReasons({});
                    }}
                  >
                    {w.remove}
                  </button>
                  {point.jumpFlag && (
                    <button
                      style={big}
                      disabled={locked || !(reasons[index] ?? "").trim()}
                      onClick={() => {
                        setSurvey((s) =>
                          acceptJump(s, index, reasons[index] ?? "", clock()),
                        );
                        setReasons({});
                      }}
                    >
                      {w.accept}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {notReady && <p role="alert">{w.notReady[notReady]}</p>}
          {locked && phase !== "saved" && <p role="status">{w.locked}</p>}
          {phase !== "refused" && phase !== "conflict" && (
            <button
              style={big}
              onClick={save}
              disabled={
                saving ||
                phase === "saved" ||
                (phase !== "unknown" && notReady !== null)
              }
            >
              {saving ? w.saving : phase === "unknown" ? w.retrySame : w.submit}
            </button>
          )}
          {phase === "refused" && (
            <button style={big} onClick={correctAndRetry}>
              {w.correct}
            </button>
          )}
        </>
      )}
      {result && (
        <p role={result.kind === "error" ? "alert" : "status"}>{result.text}</p>
      )}
      {survey.status !== "idle" && (
        <button style={big} onClick={discard} disabled={saving}>
          {phase === "unknown" ? w.discardUnsure : w.discard}
        </button>
      )}
    </section>
  );
}
