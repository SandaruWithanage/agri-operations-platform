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
  projectChangeSchema,
  type ProjectChange,
  type ProjectDetail,
} from "@agri/validation";
import {
  OnlineCreation,
  type CreationAdapter,
  type CreationDraft,
  type CreationFormProps,
} from "./online-creation";
import { projectEditWords } from "./project-edit-words";
type Source = Readonly<
  Pick<
    ProjectDetail["project"],
    "id" | "organizationId" | "version" | "name" | "active"
  >
>;
export type ProjectEditDraft = CreationDraft & { source: Source };
type Working = { name: string; active: boolean; organizationId: string };
type Value = { name: string; active: boolean };
type Props = Omit<
  ComponentProps<typeof OnlineCreation<Working, Value, ProjectChange>>,
  "adapter" | "copy" | "draft" | "onSaved"
> & { draft: ProjectEditDraft; onSaved: (projectId: string) => void };
function makeAdapter(
  source: Source,
): CreationAdapter<Working, Value, ProjectChange> {
  return {
    key: "project-edit",
    selection: (value) => value.organizationId,
    read: async (client, owner, selected, signal) => {
      const identity = await client.sessionIdentity(signal);
      if (
        identity.accountId !== owner.accountId ||
        identity.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      const detail = await client.project(source.id, signal),
        after = await client.sessionIdentity(signal);
      signal.throwIfAborted();
      if (
        detail.accountId !== owner.accountId ||
        after.accountId !== owner.accountId ||
        after.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      if (
        detail.project.id !== source.id ||
        detail.project.organizationId !== source.organizationId ||
        detail.access?.edit !== true ||
        (selected && selected !== source.organizationId)
      )
        throw new PilotRequestError(403);
      return {
        options: [
          { id: source.organizationId, label: detail.project.organizationName },
        ],
      };
    },
    request: (record) =>
      projectChangeSchema.parse({
        ...record,
        mutationId: crypto.randomUUID(),
        projectId: source.id,
        expectedVersion: source.version,
      }),
    submit: (client, owner, request) =>
      client.changeProject(owner.accountId, request, owner.deviceId),
    Form: (props) => <EditForm {...props} source={source} />,
  };
}
export function ProjectEditor(props: Props) {
  // The target and reviewed version never change during a mounted draft's lifetime.
  const [source] = useState<Source>(() => ({ ...props.draft.source }));
  const adapter = useMemo(() => makeAdapter(source), [source]);
  return (
    <OnlineCreation
      {...props}
      adapter={adapter}
      copy={projectEditWords[props.language]}
      onSaved={(request) => props.onSaved(request.projectId)}
    />
  );
}
function EditForm({
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
}: CreationFormProps<Working, Value> & { source: Source }) {
  const si = language === "si";
  const [value, setValue] = useState<Working>(
    () =>
      initialDraft ?? {
        name: source.name,
        active: source.active,
        organizationId: source.organizationId,
      },
  );
  const [saving, setSaving] = useState(false),
    [frozen, setFrozen] = useState(initiallyFrozen),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<"validation" | "save" | null>(null);
  const changed =
    value.name.trim() !== source.name || value.active !== source.active;
  useEffect(() => {
    onDirtyChange?.(changed || frozen);
  }, [changed, frozen, onDirtyChange]);
  function update(patch: Partial<Value>) {
    const next = { ...value, ...patch };
    setValue(next);
    setConfirmed(false);
    onDraftChange?.(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !enabled || (!frozen && (!changed || !confirmed))) return;
    const parsed = projectChangeSchema.safeParse({
      mutationId: source.id,
      projectId: source.id,
      expectedVersion: source.version,
      name: value.name,
      active: value.active,
    });
    if (!parsed.success) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    if (freezeAfterAttempt) setFrozen(true);
    try {
      await onSave({ name: parsed.data.name, active: parsed.data.active });
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
      aria-label={si ? "ව්‍යාපෘති සංස්කරණ විස්තර" : "Project edit details"}
    >
      <p>
        {si ? "ආයතනය" : "Organization"}:{" "}
        {options.find((item) => item.id === source.organizationId)?.label}
      </p>
      <p>
        {si ? "සමාලෝචිත අනුවාදය" : "Reviewed version"}: {source.version}
      </p>
      {error && (
        <p role="alert">
          {error === "validation"
            ? si
              ? "වලංගු ව්‍යාපෘති නමක් ඇතුළත් කරන්න."
              : "Enter a valid project name."
            : si
              ? "ප්‍රතිඵලය තහවුරු කළ නොහැකි විය. එම සංස්කරණයම නැවත උත්සාහ කරන්න."
              : "Could not confirm the project edit. Retry the same request."}
        </p>
      )}
      <label htmlFor="project-edit-name">
        {si ? "සංස්කරණය කළ ව්‍යාපෘති නම" : "Edited project name"}
      </label>
      <input
        id="project-edit-name"
        required
        maxLength={200}
        disabled={blocked}
        value={value.name}
        onChange={(event) => update({ name: event.target.value })}
      />
      <label className="review-confirmation">
        <input
          type="checkbox"
          disabled={blocked}
          checked={value.active}
          onChange={(event) => update({ active: event.target.checked })}
        />
        {si ? "නාමාවලියේ සක්‍රියයි" : "Enabled in catalog"}
      </label>
      {!frozen && (
        <label className="review-confirmation">
          <input
            type="checkbox"
            disabled={saving || !enabled}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {si
            ? "නම සහ නාමාවලි සලකුණ මම සමාලෝචනය කළෙමි."
            : "I reviewed the project name and catalog flag."}
        </label>
      )}
      <button
        type="submit"
        disabled={saving || !enabled || (!frozen && (!changed || !confirmed))}
      >
        {saving
          ? si
            ? "සංස්කරණය යවමින්…"
            : "Submitting project edit…"
          : si
            ? "ව්‍යාපෘති සංස්කරණය සුරකින්න"
            : "Save project edit"}
      </button>
    </form>
  );
}
