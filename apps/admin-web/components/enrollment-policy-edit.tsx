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
  enrollmentPolicySetSchema,
  type EnrollmentPolicySet,
} from "@agri/validation";
import {
  OnlineCreation,
  type CreationAdapter,
  type CreationDraft,
  type CreationFormProps,
} from "./online-creation";
import {
  enrollmentPolicyWords,
  policyStatusLabels,
} from "./enrollment-policy-words";
/** Statuses are the farmer registration vocabulary shared through @agri/validation. */
const statusOrder = [
  "draft",
  "pending-review",
  "verified",
  "inactive",
] as const;
type Status = (typeof statusOrder)[number];
type Source = Readonly<{
  projectId: string;
  projectName: string;
  /** 0 means no policy exists yet; the first save creates version 1. */
  version: number;
  enabled: boolean;
  eligibleFarmerStatuses: readonly Status[];
}>;
export type EnrollmentPolicyDraft = CreationDraft & { source: Source };
type Working = { enabled: boolean; eligibleFarmerStatuses: Status[] };
type Props = Omit<
  ComponentProps<typeof OnlineCreation<Working, Working, EnrollmentPolicySet>>,
  "adapter" | "copy" | "draft" | "onSaved"
> & { draft: EnrollmentPolicyDraft; onSaved: (projectId: string) => void };
function makeAdapter(
  source: Source,
): CreationAdapter<Working, Working, EnrollmentPolicySet> {
  return {
    key: "enrollment-policy",
    selection: () => source.projectId,
    read: async (client, owner, selected, signal) => {
      const identity = await client.sessionIdentity(signal);
      if (
        identity.accountId !== owner.accountId ||
        identity.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      // Reading the policy proves current administrator authority; a 404 means no access.
      const detail = await client.enrollmentPolicy(source.projectId, signal),
        after = await client.sessionIdentity(signal);
      signal.throwIfAborted();
      if (
        detail.accountId !== owner.accountId ||
        after.accountId !== owner.accountId ||
        after.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      if (
        detail.projectId !== source.projectId ||
        (selected && selected !== source.projectId)
      )
        throw new PilotRequestError(403);
      return { options: [{ id: source.projectId, label: source.projectName }] };
    },
    request: (record) =>
      enrollmentPolicySetSchema.parse({
        ...record,
        mutationId: crypto.randomUUID(),
        projectId: source.projectId,
        expectedVersion: source.version,
      }),
    submit: (client, owner, request) =>
      client.setEnrollmentPolicy(owner.accountId, request, owner.deviceId),
    Form: (props) => <PolicyForm {...props} source={source} />,
  };
}
export function EnrollmentPolicyEditor(props: Props) {
  // The target and reviewed version never change during a mounted draft's lifetime.
  const [source] = useState<Source>(() => ({ ...props.draft.source }));
  const adapter = useMemo(() => makeAdapter(source), [source]);
  return (
    <OnlineCreation
      {...props}
      adapter={adapter}
      copy={enrollmentPolicyWords[props.language]}
      onSaved={(request) => props.onSaved(request.projectId)}
    />
  );
}
function PolicyForm({
  source,
  language,
  enabled = true,
  freezeAfterAttempt = false,
  initiallyFrozen = false,
  initialDraft,
  onDraftChange,
  onDirtyChange,
  onSave,
}: CreationFormProps<Working, Working> & { source: Source }) {
  const copy = enrollmentPolicyWords[language];
  const labels = policyStatusLabels[language];
  const initial: Working = {
    enabled: source.enabled,
    eligibleFarmerStatuses: statusOrder.filter((status) =>
      source.eligibleFarmerStatuses.includes(status),
    ),
  };
  const [value, setValue] = useState<Working>(() => initialDraft ?? initial);
  const [saving, setSaving] = useState(false),
    [frozen, setFrozen] = useState(initiallyFrozen),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<"validation" | "save" | null>(null);
  const changed =
    source.version === 0 ||
    value.enabled !== initial.enabled ||
    value.eligibleFarmerStatuses.join() !==
      initial.eligibleFarmerStatuses.join();
  // Register the working draft immediately so a first policy can be saved without touching a field.
  useEffect(() => {
    onDraftChange?.(value);
  }, []);
  useEffect(() => {
    onDirtyChange?.(changed || frozen);
  }, [changed, frozen, onDirtyChange]);
  function update(next: Working) {
    setValue(next);
    setConfirmed(false);
    onDraftChange?.(next);
  }
  function toggle(status: Status, on: boolean) {
    const list = statusOrder.filter((item) =>
      item === status ? on : value.eligibleFarmerStatuses.includes(item),
    );
    update({ ...value, eligibleFarmerStatuses: list });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !enabled || (!frozen && (!changed || !confirmed))) return;
    const parsed = enrollmentPolicySetSchema.safeParse({
      mutationId: source.projectId,
      projectId: source.projectId,
      expectedVersion: source.version,
      ...value,
    });
    if (!parsed.success) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    if (freezeAfterAttempt) setFrozen(true);
    try {
      await onSave({
        enabled: parsed.data.enabled,
        eligibleFarmerStatuses: parsed.data.eligibleFarmerStatuses,
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
      aria-label={copy.title}
    >
      <p>
        {copy.project}: {source.projectName}
      </p>
      <p>
        {copy.version}: {source.version}
      </p>
      {source.version === 0 && <p role="status">{copy.none}</p>}
      {error && (
        <p role="alert">
          {error === "validation" ? copy.invalid : copy.failed}
        </p>
      )}
      <label className="review-confirmation">
        <input
          type="checkbox"
          disabled={blocked}
          checked={value.enabled}
          onChange={(event) =>
            update({ ...value, enabled: event.target.checked })
          }
        />
        {copy.enabled}
      </label>
      <fieldset disabled={blocked}>
        <legend>{copy.statuses}</legend>
        {statusOrder.map((status) => (
          <label className="review-confirmation" key={status}>
            <input
              type="checkbox"
              checked={value.eligibleFarmerStatuses.includes(status)}
              onChange={(event) => toggle(status, event.target.checked)}
            />
            {labels[status]}
          </label>
        ))}
      </fieldset>
      {!frozen && (
        <label className="review-confirmation">
          <input
            type="checkbox"
            disabled={saving || !enabled}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {copy.review}
        </label>
      )}
      <button
        type="submit"
        disabled={saving || !enabled || (!frozen && (!changed || !confirmed))}
      >
        {saving ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
