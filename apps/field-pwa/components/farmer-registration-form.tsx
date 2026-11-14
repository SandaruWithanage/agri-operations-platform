"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  farmerRegistrationSchema,
  type FarmerRegistration,
} from "@agri/validation";

/** This form has no identity or authorization of its own. Mount only after the server verifies both. */
type GeographyOption = { id: string; label: string };
type Props = {
  language: "en" | "si";
  /** Options must come from the signed-in user's currently authorized server-side scope. */
  geographies: readonly GeographyOption[];
  /** Must atomically save locally and make retries with the same farmer UUID safe. */
  onSave: (record: FarmerRegistration) => Promise<void>;
};
const messages = {
  en: {
    heading: "Farmer registration",
    name: "Full name",
    geography: "GN division or village",
    choose: "Select a location",
    notice: "I provided the required privacy notice",
    submit: "Save registration",
    errors:
      "Enter a name, select a valid location, and confirm the privacy notice.",
    failure: "Could not save the registration. Please try again.",
    saving: "Saving…",
    unavailable: "No authorized locations are available.",
  },
  si: {
    heading: "ගොවි ලියාපදිංචිය",
    name: "සම්පූර්ණ නම",
    geography: "ග්‍රාම නිලධාරී වසම හෝ ගම",
    choose: "ස්ථානයක් තෝරන්න",
    notice: "අවශ්‍ය පෞද්ගලිකත්ව දැනුම්දීම ලබා දුන්නා",
    submit: "ලියාපදිංචිය සුරකින්න",
    errors: "නමක් ඇතුළත් කර වලංගු ස්ථානයක් තෝරා පෞද්ගලිකත්ව දැනුම්දීම තහවුරු කරන්න.",
    failure: "ලියාපදිංචිය සුරැකීමට නොහැකි විය. නැවත උත්සාහ කරන්න.",
    saving: "සුරකිමින්…",
    unavailable: "අවසර ලත් ස්ථාන නොමැත.",
  },
} as const;

export function FarmerRegistrationForm({
  language,
  geographies,
  onSave,
}: Props) {
  const copy = messages[language];
  const [fullName, setFullName] = useState("");
  const [geographyId, setGeographyId] = useState("");
  const [notice, setNotice] = useState(false);
  const [error, setError] = useState<"validation" | "save" | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingFarmerId = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    pendingFarmerId.current ??= crypto.randomUUID();
    const parsed = farmerRegistrationSchema.safeParse({
      farmerId: pendingFarmerId.current,
      fullName,
      geographyId,
      privacyNoticeProvided: notice,
    });
    if (
      !parsed.success ||
      !geographies.some((option) => option.id === geographyId)
    ) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(parsed.data);
      pendingFarmerId.current = null;
      setFullName("");
      setGeographyId("");
      setNotice(false);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="registration-form"
      onSubmit={submit}
      noValidate
      aria-labelledby="farmer-form-heading"
    >
      <h1 id="farmer-form-heading">{copy.heading}</h1>
      {error && (
        <p role="alert">
          {error === "validation" ? copy.errors : copy.failure}
        </p>
      )}
      {geographies.length === 0 && <p role="status">{copy.unavailable}</p>}
      <label htmlFor="farmer-full-name">{copy.name}</label>
      <input
        id="farmer-full-name"
        disabled={saving}
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        autoComplete="name"
        required
        maxLength={200}
      />
      <label htmlFor="farmer-geography">{copy.geography}</label>
      <select
        id="farmer-geography"
        disabled={saving}
        value={geographyId}
        onChange={(event) => setGeographyId(event.target.value)}
        required
      >
        <option value="">{copy.choose}</option>
        {geographies.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <label>
        <input
          type="checkbox"
          disabled={saving}
          checked={notice}
          onChange={(event) => setNotice(event.target.checked)}
          required
        />{" "}
        {copy.notice}
      </label>
      <button type="submit" disabled={saving || geographies.length === 0}>
        {saving ? copy.saving : copy.submit}
      </button>
    </form>
  );
}
