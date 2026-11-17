"use client";

import { useEffect, useRef, useState } from "react";
import { PilotClient, PilotRequestError } from "../lib/pilot-client";
import { WalkSurveyScreen } from "./walk-survey-screen";

type Language = "en" | "si";
type LandItem = { id: string; label: string | null; geographyName: string };

const words = {
  en: {
    title: "Survey a land perimeter",
    intro:
      "Choose a land you are assigned to, then walk its boundary. This works online only; offline survey drafts are not available yet.",
    loading: "Loading…",
    pick: "Land",
    unnamed: "Unnamed land",
    more: "Load more",
    none: "No land is available to you.",
    existing: "Existing provisional polygon version",
    existingNote:
      "Saving creates a new version; the earlier polygon is kept as history, not overwritten.",
    noneYet: "This land has no polygon yet.",
    back: "Choose another land",
    auth: "Sign in on the home page, then return here.",
    denied: "You do not have permission to read this land's geometry.",
    failure: "Could not load. Check your connection and try again.",
    retry: "Try again",
  },
  si: {
    title: "ඉඩම් මායිම මැනීම",
    intro:
      "ඔබට පවරා ඇති ඉඩමක් තෝරා එහි මායිම ඇවිදින්න. මෙය සබැඳිව පමණක් ක්‍රියා කරයි; නොබැඳි මැනුම් කෙටුම්පත් තවම නැත.",
    loading: "පූරණය වෙමින්…",
    pick: "ඉඩම",
    unnamed: "නම් නැති ඉඩම",
    more: "තවත් පූරණය කරන්න",
    none: "ඔබට ලබාගත හැකි ඉඩමක් නැත.",
    existing: "දැනට පවතින තාවකාලික බහුඅස්‍ර අනුවාදය",
    existingNote:
      "සුරැකීමෙන් නව අනුවාදයක් සෑදේ; පෙර බහුඅස්‍රය ඉතිහාසය ලෙස රැඳේ, උඩින් නොලියවේ.",
    noneYet: "මෙම ඉඩමට තවම බහුඅස්‍රයක් නැත.",
    back: "වෙනත් ඉඩමක් තෝරන්න",
    auth: "මුල් පිටුවෙන් පුරන්න, ඉන්පසු මෙතැනට ආපසු එන්න.",
    denied: "මෙම ඉඩමේ ජ්‍යාමිතිය කියවීමට ඔබට අවසර නැත.",
    failure: "පූරණය කළ නොහැකි විය. සම්බන්ධතාව පරීක්ෂා කර නැවත උත්සාහ කරන්න.",
    retry: "නැවත උත්සාහ කරන්න",
  },
};

/** Online-only land picker that mounts the walk survey with the land's current geometry version. */
export function LandSurveyWorkspace({
  language,
  client: supplied,
}: {
  language: Language;
  client?: PilotClient;
}) {
  const w = words[language];
  const [fallback] = useState(() => new PilotClient());
  const client = supplied ?? fallback;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [lands, setLands] = useState<LandItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "auth" | "denied" | "failure"
  >("loading");
  const [chosen, setChosen] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<
    | { landId: string; version: number; area: number | null }
    | "loading"
    | "failure"
    | null
  >(null);
  // Responses for a land the officer has already moved away from must never be applied.
  const sequence = useRef(0);

  function problem(error: unknown) {
    const status = error instanceof PilotRequestError ? error.status : 503;
    return status === 401 ? "auth" : status === 403 ? "denied" : "failure";
  }
  async function load(after?: string) {
    try {
      const identity = await client.sessionIdentity();
      setAccountId(identity.accountId);
      const page = await client.land(after);
      setLands((current) => [
        ...(after ? current : []),
        ...page.items.map((item) => ({
          id: item.id,
          label: item.label,
          geographyName: item.geographyName,
        })),
      ]);
      setCursor(page.nextCursor);
      setState("ready");
    } catch (error) {
      setState(problem(error));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function choose(id: string) {
    const mine = ++sequence.current;
    setChosen(id || null);
    setGeometry(id ? "loading" : null);
    if (!id) return;
    try {
      const read = await client.landGeometry(id);
      if (mine !== sequence.current) return;
      setGeometry({
        landId: id,
        version: read.current?.version ?? 0,
        area: read.current?.calculatedAreaM2 ?? null,
      });
    } catch (error) {
      if (mine !== sequence.current) return;
      // 404 means no polygon exists yet (or none is visible); the first version is expected at 0.
      if (error instanceof PilotRequestError && error.status === 404)
        setGeometry({ landId: id, version: 0, area: null });
      else if (problem(error) === "failure") setGeometry("failure");
      else {
        setChosen(null);
        setGeometry(null);
        setState(problem(error));
      }
    }
  }

  if (state === "loading") return <p role="status">{w.loading}</p>;
  if (state === "auth") return <p role="alert">{w.auth}</p>;
  if (state === "denied") return <p role="alert">{w.denied}</p>;
  if (state === "failure")
    return (
      <p role="alert">
        {w.failure}{" "}
        <button
          style={{ minHeight: 48 }}
          onClick={() => {
            setState("loading");
            void load();
          }}
        >
          {w.retry}
        </button>
      </p>
    );
  const ready =
    geometry !== null && geometry !== "loading" && geometry !== "failure"
      ? geometry
      : null;
  return (
    <section aria-labelledby="survey-title">
      <h2 id="survey-title">{w.title}</h2>
      <p>{w.intro}</p>
      {lands.length === 0 ? (
        <p role="status">{w.none}</p>
      ) : (
        <>
          <label htmlFor="survey-land">{w.pick}</label>
          <select
            id="survey-land"
            value={chosen ?? ""}
            style={{ minHeight: 48 }}
            onChange={(event) => void choose(event.target.value)}
          >
            <option value="" />
            {lands.map((land) => (
              <option key={land.id} value={land.id}>
                {land.label ?? w.unnamed} — {land.geographyName}
              </option>
            ))}
          </select>
          {cursor && (
            <button style={{ minHeight: 48 }} onClick={() => void load(cursor)}>
              {w.more}
            </button>
          )}
        </>
      )}
      {geometry === "loading" && <p role="status">{w.loading}</p>}
      {geometry === "failure" && (
        <p role="alert">
          {w.failure}{" "}
          <button
            style={{ minHeight: 48 }}
            onClick={() => chosen && void choose(chosen)}
          >
            {w.retry}
          </button>
        </p>
      )}
      {ready && accountId && (
        <>
          <p role="status">
            {ready.version === 0
              ? w.noneYet
              : `${w.existing} ${ready.version}. ${w.existingNote}`}
          </p>
          <WalkSurveyScreen
            key={`${ready.landId}:${ready.version}`}
            language={language}
            accountId={accountId}
            landId={ready.landId}
            expectedVersion={ready.version}
            client={client}
          />
          <button style={{ minHeight: 48 }} onClick={() => void choose("")}>
            {w.back}
          </button>
        </>
      )}
    </section>
  );
}
