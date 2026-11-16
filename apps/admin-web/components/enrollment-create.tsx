"use client";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { PilotRequestError } from "@agri/sync-client";
import {
  enrollmentCreateSchema,
  type EnrollmentCreate,
} from "@agri/validation";
import {
  OnlineCreation,
  type CreationAdapter,
  type CreationDraft,
  type CreationFormProps,
} from "./online-creation";
import { enrollmentCreateWords } from "./enrollment-create-words";
type Source = Readonly<{ farmerId: string; farmerName: string }>;
export type EnrollmentCreateDraft = CreationDraft & { source: Source };
type Working = { projectId: string };
/** Bounded catalog read: a handful of pages is enough for a project catalog; more is refused, not truncated silently. */
const maxCatalogPages = 4;
type Props = Omit<
  ComponentProps<typeof OnlineCreation<Working, Working, EnrollmentCreate>>,
  "adapter" | "copy" | "draft" | "onSaved"
> & { draft: EnrollmentCreateDraft; onSaved: (enrollmentId: string) => void };
function makeAdapter(
  source: Source,
): CreationAdapter<Working, Working, EnrollmentCreate> {
  return {
    key: "enrollment-create",
    selection: (value) => value.projectId || undefined,
    read: async (client, owner, _selected, signal) => {
      const identity = await client.sessionIdentity(signal);
      if (
        identity.accountId !== owner.accountId ||
        identity.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      // The farmer must still be readable; project names come only from the caller's own catalog read.
      const farmer = await client.farmer(source.farmerId, signal);
      if (
        farmer.accountId !== owner.accountId ||
        farmer.farmer.id !== source.farmerId
      )
        throw new PilotRequestError(403);
      const options: { id: string; label: string }[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < maxCatalogPages; page++) {
        const result = await client.projects(cursor, signal);
        if (result.accountId !== owner.accountId)
          throw new PilotRequestError(401);
        for (const item of result.items)
          options.push({
            id: item.id,
            label: `${item.name} — ${item.organizationName}`,
          });
        cursor = result.nextCursor ?? undefined;
        if (!cursor) break;
      }
      const after = await client.sessionIdentity(signal);
      signal.throwIfAborted();
      if (
        after.accountId !== owner.accountId ||
        after.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      if (cursor) throw new PilotRequestError(503);
      return { options };
    },
    request: (record) =>
      enrollmentCreateSchema.parse({
        mutationId: crypto.randomUUID(),
        enrollmentId: crypto.randomUUID(),
        projectId: record.projectId,
        farmerId: source.farmerId,
      }),
    submit: (client, owner, request) =>
      client.enrollFarmer(owner.accountId, request, owner.deviceId),
    Form: (props) => <CreateForm {...props} source={source} />,
  };
}
export function EnrollmentCreateEditor(props: Props) {
  // The farmer never changes during a mounted draft's lifetime.
  const [source] = useState<Source>(() => ({ ...props.draft.source }));
  const adapter = useMemo(() => makeAdapter(source), [source]);
  return (
    <OnlineCreation
      {...props}
      adapter={adapter}
      copy={enrollmentCreateWords[props.language]}
      onSaved={(request) => props.onSaved(request.enrollmentId)}
    />
  );
}
function CreateForm({
  source,
  language,
  options,
  enabled = true,
  freezeAfterAttempt = false,
  initiallyFrozen = false,
  initialDraft,
  onDraftChange,
  onDirtyChange,
  onSave,
}: CreationFormProps<Working, Working> & { source: Source }) {
  const copy = enrollmentCreateWords[language];
  const [value, setValue] = useState<Working>(
    () => initialDraft ?? { projectId: "" },
  );
  const [saving, setSaving] = useState(false),
    [frozen, setFrozen] = useState(initiallyFrozen),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<"validation" | "save" | null>(null);
  const chosen = options.some((item) => item.id === value.projectId);
  useEffect(() => {
    onDraftChange?.(value);
    // Registered once on open so a reopened draft keeps its choice.
  }, []);
  useEffect(() => {
    onDirtyChange?.(chosen || frozen);
  }, [chosen, frozen, onDirtyChange]);
  function choose(projectId: string) {
    const next = { projectId };
    setValue(next);
    setConfirmed(false);
    onDraftChange?.(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !enabled || (!frozen && (!chosen || !confirmed))) return;
    if (!chosen) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    if (freezeAfterAttempt) setFrozen(true);
    try {
      await onSave(value);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }
  const blocked = saving || frozen || !enabled;
  return (
    <form
      autoComplete="off"
      noValidate
      onSubmit={submit}
      aria-label={copy.title}
    >
      <p>
        {copy.farmer}: {source.farmerName}
      </p>
      {!options.length && <p role="status">{copy.none}</p>}
      {error && (
        <p role="alert">
          {error === "validation" ? copy.invalid : copy.failed}
        </p>
      )}
      <label htmlFor="enrollment-project">{copy.project}</label>
      <select
        id="enrollment-project"
        disabled={blocked || !options.length}
        value={chosen ? value.projectId : ""}
        onChange={(event) => choose(event.target.value)}
      >
        <option value="">{copy.choose}</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {!frozen && (
        <label className="review-confirmation">
          <input
            type="checkbox"
            disabled={saving || !enabled || !chosen}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {copy.review}
        </label>
      )}
      <button
        type="submit"
        disabled={saving || !enabled || (!frozen && (!chosen || !confirmed))}
      >
        {saving ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
