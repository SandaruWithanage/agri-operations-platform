"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  landRegistrationSchema,
  landPointSchema,
  type LandRegistration,
} from "@agri/validation";
import type { CreationFormProps } from "./online-creation";
export type WorkingLand = {
  landId: string;
  geographyId: string;
  label: string;
  latitude: string;
  longitude: string;
  accuracy: string;
  area: string;
};
export type LandRecord = Omit<LandRegistration, "mutationId">;
const words = {
  en: {
    title: "Record reported land",
    geography: "GN division or village",
    choose: "Select an authorized location",
    label: "Land label (optional)",
    latitude: "Latitude (optional)",
    longitude: "Longitude (optional)",
    accuracy: "Reported accuracy in metres (optional)",
    area: "Reported area in hectares (optional)",
    gps: "Use current GPS location",
    cancel: "Cancel GPS request",
    clear: "Clear GPS point",
    locating: "Requesting current location…",
    gpsFailure:
      "Location could not be obtained. You may retry, enter a reported point, or save without GPS.",
    validation:
      "Select an authorized location. Provide both valid coordinates or neither; accuracy needs a point. Area supports up to four decimal places.",
    failure:
      "Could not confirm the land registration. Keep this tab open and retry the same request.",
    fixed: "The submitted values are fixed for safe retry.",
    unavailable: "No authorized land locations are available.",
    save: "Save reported land",
    saving: "Submitting reported land…",
  },
  si: {
    title: "වාර්තා කළ ඉඩම සටහන් කරන්න",
    geography: "ග්‍රාම නිලධාරී වසම හෝ ගම",
    choose: "අවසර ලත් ස්ථානයක් තෝරන්න",
    label: "ඉඩම් නාමය (විකල්ප)",
    latitude: "අක්ෂාංශ (විකල්ප)",
    longitude: "දේශාංශ (විකල්ප)",
    accuracy: "වාර්තා කළ නිරවද්‍යතාව මීටර් වලින් (විකල්ප)",
    area: "වාර්තා කළ වපසරිය හෙක්ටයාර වලින් (විකල්ප)",
    gps: "වත්මන් GPS ස්ථානය භාවිත කරන්න",
    cancel: "GPS ඉල්ලීම අවලංගු කරන්න",
    clear: "GPS ලක්ෂ්‍යය ඉවත් කරන්න",
    locating: "වත්මන් ස්ථානය ඉල්ලමින්…",
    gpsFailure:
      "ස්ථානය ලබාගත නොහැකි විය. නැවත උත්සාහ කරන්න, ලක්ෂ්‍යයක් ඇතුළත් කරන්න හෝ GPS නොමැතිව සුරකින්න.",
    validation:
      "අවසර ලත් ස්ථානයක් තෝරන්න. වලංගු ඛණ්ඩාංක දෙකම දෙන්න හෝ දෙකම හිස්ව තබන්න. නිරවද්‍යතාව සඳහා ලක්ෂ්‍යයක් අවශ්‍යයි. වපසරියට දශම ස්ථාන හතරක් දක්වා භාවිත කළ හැක.",
    failure:
      "ඉඩම් ලියාපදිංචිය තහවුරු කළ නොහැකි විය. මෙම ටැබය විවෘතව තබා එම ඉල්ලීමම නැවත උත්සාහ කරන්න.",
    fixed: "ආරක්ෂිත නැවත උත්සාහය සඳහා යැවූ අගයන් නොවෙනස්ව තබා ඇත.",
    unavailable: "අවසර ලත් ඉඩම් ස්ථාන නොමැත.",
    save: "වාර්තා කළ ඉඩම සුරකින්න",
    saving: "වාර්තා කළ ඉඩම යවමින්…",
  },
} as const;
export function LandRegistrationForm({
  language,
  geographies,
  enabled = true,
  freezeAfterAttempt = false,
  initiallyFrozen = false,
  initialDraft,
  onDraftChange,
  onDirtyChange,
  onSave,
}: CreationFormProps<WorkingLand, LandRecord>) {
  const copy = words[language];
  const [value, setValue] = useState<WorkingLand>(
    () =>
      initialDraft ?? {
        landId: crypto.randomUUID(),
        geographyId: "",
        label: "",
        latitude: "",
        longitude: "",
        accuracy: "",
        area: "",
      },
  );
  const [saving, setSaving] = useState(false),
    [frozen, setFrozen] = useState(initiallyFrozen);
  const [error, setError] = useState<"validation" | "failure" | null>(null);
  const [locating, setLocating] = useState(false),
    [gpsFailed, setGpsFailed] = useState(false);
  const active = useRef(true),
    generation = useRef(0),
    enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(
      frozen ||
        Boolean(
          value.geographyId ||
          value.label ||
          value.latitude ||
          value.longitude ||
          value.accuracy ||
          value.area,
        ),
    );
  }, [value, frozen, onDirtyChange]);
  const blocked = saving || frozen || !enabled;
  function update(patch: Partial<WorkingLand>) {
    generation.current++;
    setLocating(false);
    setValue((previous) => {
      const next = { ...previous, ...patch };
      onDraftChange?.(next);
      return next;
    });
  }
  function locate() {
    if (blocked || locating) return;
    const attempt = ++generation.current;
    setGpsFailed(false);
    if (!window.isSecureContext || !navigator.geolocation) {
      setGpsFailed(true);
      return;
    }
    setLocating(true);
    const valid = () =>
      active.current &&
      enabledRef.current &&
      attempt === generation.current &&
      document.visibilityState !== "hidden";
    const failed = () => {
      if (valid()) {
        setLocating(false);
        setGpsFailed(true);
      }
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!valid()) return;
          const point = landPointSchema.safeParse({
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            accuracyM: position.coords.accuracy,
          });
          if (!point.success) {
            failed();
            return;
          }
          update({
            longitude: String(point.data.longitude),
            latitude: String(point.data.latitude),
            accuracy:
              point.data.accuracyM === null ? "" : String(point.data.accuracyM),
          });
        },
        failed,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } catch {
      failed();
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || locating || !enabled) return;
    if (
      Array.from(
        (
          event.currentTarget as HTMLFormElement
        ).querySelectorAll<HTMLInputElement>('input[type="number"]'),
      ).some((input) => input.validity.badInput)
    ) {
      setError("validation");
      return;
    }
    const latitude = value.latitude.trim(),
      longitude = value.longitude.trim(),
      accuracy = value.accuracy.trim();
    const hasPoint = Boolean(latitude || longitude);
    const parsed = landRegistrationSchema.safeParse({
      mutationId: value.landId,
      landId: value.landId,
      geographyId: value.geographyId,
      label: value.label.trim() || null,
      point: hasPoint
        ? {
            latitude: latitude ? Number(latitude) : NaN,
            longitude: longitude ? Number(longitude) : NaN,
            accuracyM: accuracy ? Number(accuracy) : null,
          }
        : null,
      reportedAreaHectares: value.area.trim() ? Number(value.area) : null,
    });
    if (
      !parsed.success ||
      (!hasPoint && accuracy) ||
      !geographies.some((item) => item.id === value.geographyId)
    ) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    if (freezeAfterAttempt) setFrozen(true);
    const record: LandRecord = {
      landId: parsed.data.landId,
      geographyId: parsed.data.geographyId,
      label: parsed.data.label,
      point: parsed.data.point,
      reportedAreaHectares: parsed.data.reportedAreaHectares,
    };
    try {
      await onSave(record);
    } catch {
      if (active.current) setError("failure");
    } finally {
      if (active.current) setSaving(false);
    }
  }
  return (
    <form
      autoComplete="off"
      noValidate
      onSubmit={submit}
      aria-label={copy.title}
    >
      <h3>{copy.title}</h3>
      {error && <p role="alert">{copy[error]}</p>}
      {frozen && <p role="status">{copy.fixed}</p>}
      {!geographies.length && <p role="status">{copy.unavailable}</p>}
      <label htmlFor="land-create-geography">{copy.geography}</label>
      <select
        id="land-create-geography"
        required
        disabled={blocked}
        value={value.geographyId}
        onChange={(event) => update({ geographyId: event.target.value })}
      >
        <option value="">{copy.choose}</option>
        {geographies.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <label>
        {copy.label}
        <input
          maxLength={200}
          disabled={blocked}
          value={value.label}
          onChange={(event) => update({ label: event.target.value })}
        />
      </label>
      {(["latitude", "longitude", "accuracy", "area"] as const).map((key) => (
        <label key={key}>
          {copy[key]}
          <input
            type="number"
            step={key === "area" ? "0.0001" : "any"}
            disabled={blocked}
            value={value[key]}
            onChange={(event) => update({ [key]: event.target.value })}
          />
        </label>
      ))}
      <div className="actions">
        <button type="button" disabled={blocked || locating} onClick={locate}>
          {copy.gps}
        </button>
        {locating && (
          <button
            type="button"
            onClick={() => {
              generation.current++;
              setLocating(false);
            }}
          >
            {copy.cancel}
          </button>
        )}
        <button
          type="button"
          disabled={blocked}
          onClick={() => {
            update({ latitude: "", longitude: "", accuracy: "" });
            setGpsFailed(false);
          }}
        >
          {copy.clear}
        </button>
      </div>
      {locating && <p role="status">{copy.locating}</p>}
      {gpsFailed && <p role="alert">{copy.gpsFailure}</p>}
      <button
        type="submit"
        disabled={saving || locating || !enabled || !geographies.length}
      >
        {saving ? copy.saving : copy.save}
      </button>
    </form>
  );
}
