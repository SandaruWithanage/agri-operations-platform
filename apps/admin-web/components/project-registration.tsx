"use client";
import {
  useEffect,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { PilotRequestError } from "@agri/sync-client";
import {
  projectRegistrationSchema,
  type ProjectRegistration,
} from "@agri/validation";
import {
  OnlineCreation,
  type CreationAdapter,
  type CreationFormProps,
} from "./online-creation";
import { projectCreationWords, projectWords } from "./project-words";
type WorkingProject = {
  projectId: string;
  organizationId: string;
  name: string;
  active: boolean;
};
type ProjectRecord = Omit<ProjectRegistration, "mutationId">;
const adapter: CreationAdapter<
  WorkingProject,
  ProjectRecord,
  ProjectRegistration
> = {
  key: "project-creation",
  selection: (value) => value.organizationId,
  read: async (client, owner, selected, signal) => {
    const identity = await client.sessionIdentity(signal);
    if (
      identity.accountId !== owner.accountId ||
      identity.deviceId !== owner.deviceId
    )
      throw new PilotRequestError(401);
    const choices = await client.projectOrganizations(signal),
      after = await client.sessionIdentity(signal);
    signal.throwIfAborted();
    if (
      choices.accountId !== owner.accountId ||
      after.accountId !== owner.accountId ||
      after.deviceId !== owner.deviceId
    )
      throw new PilotRequestError(401);
    if (
      selected &&
      !choices.organizations.some((value) => value.id === selected)
    )
      throw new PilotRequestError(403);
    return {
      options: choices.organizations.map((value) => ({
        id: value.id,
        label: value.name,
      })),
    };
  },
  request: (record) => ({ ...record, mutationId: crypto.randomUUID() }),
  submit: (client, owner, request) =>
    client.registerProject(owner.accountId, request, owner.deviceId),
  Form: ProjectForm,
};
type Props = Omit<
  ComponentProps<
    typeof OnlineCreation<WorkingProject, ProjectRecord, ProjectRegistration>
  >,
  "adapter" | "copy" | "onSaved"
> & { onSaved: (projectId: string) => void };
export function ProjectRegistrationEditor(props: Props) {
  return (
    <OnlineCreation
      {...props}
      adapter={adapter}
      copy={projectCreationWords[props.language]}
      onSaved={(request) => props.onSaved(request.projectId)}
    />
  );
}
function ProjectForm({
  language,
  options,
  enabled = true,
  freezeAfterAttempt = false,
  initiallyFrozen = false,
  initialDraft,
  onDraftChange,
  onDirtyChange,
  onSave,
}: CreationFormProps<WorkingProject, ProjectRecord>) {
  const copy = projectWords[language],
    si = language === "si";
  const [value, setValue] = useState<WorkingProject>(
    () =>
      initialDraft ?? {
        projectId: crypto.randomUUID(),
        organizationId: "",
        name: "",
        active: false,
      },
  );
  const [saving, setSaving] = useState(false),
    [frozen, setFrozen] = useState(initiallyFrozen),
    [error, setError] = useState<"validation" | "save" | null>(null);
  useEffect(() => {
    onDirtyChange?.(
      Boolean(value.name || value.organizationId || value.active || frozen),
    );
  }, [value, frozen, onDirtyChange]);
  function update(patch: Partial<WorkingProject>) {
    const next = { ...value, ...patch };
    setValue(next);
    onDraftChange?.(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !enabled) return;
    const parsed = projectRegistrationSchema.safeParse({
      ...value,
      mutationId: value.projectId,
    });
    if (
      !parsed.success ||
      !options.some((item) => item.id === value.organizationId)
    ) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    if (freezeAfterAttempt) setFrozen(true);
    try {
      await onSave({
        projectId: parsed.data.projectId,
        organizationId: parsed.data.organizationId,
        name: parsed.data.name,
        active: parsed.data.active,
      });
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
      aria-label={si ? "ව්‍යාපෘති විස්තර" : "Project details"}
    >
      {error && (
        <p role="alert">
          {error === "validation"
            ? si
              ? "ව්‍යාපෘති නමක් සහ අවසර ලත් ආයතනයක් තෝරන්න."
              : "Enter a project name and select an authorized organization."
            : si
              ? "ප්‍රතිඵලය තහවුරු කළ නොහැකි විය. එම ඉල්ලීමම නැවත උත්සාහ කරන්න."
              : "Could not confirm the project creation. Retry the same request."}
        </p>
      )}
      {!options.length && (
        <p role="status">
          {si
            ? "ව්‍යාපෘති සෑදීමට අවසර ලත් ආයතන නොමැත."
            : "No organizations are available within current project-create permissions."}
        </p>
      )}
      <label htmlFor="project-create-name">{copy.name}</label>
      <input
        id="project-create-name"
        required
        maxLength={200}
        disabled={blocked}
        value={value.name}
        onChange={(event) => update({ name: event.target.value })}
      />
      <label htmlFor="project-create-organization">{copy.organization}</label>
      <select
        id="project-create-organization"
        required
        disabled={blocked}
        value={value.organizationId}
        onChange={(event) => update({ organizationId: event.target.value })}
      >
        <option value="">
          {si ? "අවසර ලත් ආයතනයක් තෝරන්න" : "Select an authorized organization"}
        </option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <label className="review-confirmation">
        <input
          type="checkbox"
          checked={value.active}
          disabled={blocked}
          onChange={(event) => update({ active: event.target.checked })}
        />
        {copy.enabled}
      </label>
      <button type="submit" disabled={saving || !enabled || !options.length}>
        {saving
          ? si
            ? "ව්‍යාපෘතිය යවමින්…"
            : "Submitting project…"
          : si
            ? "නාමාවලි ව්‍යාපෘතිය සුරකින්න"
            : "Save catalog project"}
      </button>
    </form>
  );
}
