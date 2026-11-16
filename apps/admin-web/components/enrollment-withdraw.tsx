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
  enrollmentWithdrawSchema,
  type EnrollmentDetail,
  type EnrollmentWithdraw,
} from "@agri/validation";
import {
  OnlineCreation,
  type CreationAdapter,
  type CreationDraft,
  type CreationFormProps,
} from "./online-creation";
import { enrollmentWithdrawWords } from "./enrollment-words";
type Source = Readonly<
  Pick<
    EnrollmentDetail["enrollment"],
    "id" | "projectId" | "farmerId" | "version"
  >
>;
export type EnrollmentWithdrawDraft = CreationDraft & { source: Source };
type Working = Record<string, never>;
type Props = Omit<
  ComponentProps<typeof OnlineCreation<Working, Working, EnrollmentWithdraw>>,
  "adapter" | "copy" | "draft" | "onSaved"
> & { draft: EnrollmentWithdrawDraft; onSaved: (enrollmentId: string) => void };
function makeAdapter(
  source: Source,
): CreationAdapter<Working, Working, EnrollmentWithdraw> {
  return {
    key: "enrollment-withdraw",
    selection: () => source.id,
    read: async (client, owner, selected, signal) => {
      const identity = await client.sessionIdentity(signal);
      if (
        identity.accountId !== owner.accountId ||
        identity.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      // A current read proves the record is still visible and enrolled before the form reopens.
      const detail = await client.enrollment(source.id, signal),
        after = await client.sessionIdentity(signal);
      signal.throwIfAborted();
      if (
        detail.accountId !== owner.accountId ||
        after.accountId !== owner.accountId ||
        after.deviceId !== owner.deviceId
      )
        throw new PilotRequestError(401);
      if (
        detail.enrollment.id !== source.id ||
        detail.enrollment.status !== "enrolled" ||
        (selected && selected !== source.id)
      )
        throw new PilotRequestError(403);
      return { options: [{ id: source.id, label: source.id }] };
    },
    request: () =>
      enrollmentWithdrawSchema.parse({
        mutationId: crypto.randomUUID(),
        enrollmentId: source.id,
        expectedVersion: source.version,
      }),
    submit: (client, owner, request) =>
      client.withdrawEnrollment(owner.accountId, request, owner.deviceId),
    Form: (props) => <WithdrawForm {...props} source={source} />,
  };
}
export function EnrollmentWithdrawEditor(props: Props) {
  // The target and reviewed version never change during a mounted draft's lifetime.
  const [source] = useState<Source>(() => ({ ...props.draft.source }));
  const adapter = useMemo(() => makeAdapter(source), [source]);
  return (
    <OnlineCreation
      {...props}
      adapter={adapter}
      copy={enrollmentWithdrawWords[props.language]}
      onSaved={(request) => props.onSaved(request.enrollmentId)}
    />
  );
}
function WithdrawForm({
  source,
  language,
  enabled = true,
  freezeAfterAttempt = false,
  initiallyFrozen = false,
  onDraftChange,
  onDirtyChange,
  onSave,
}: CreationFormProps<Working, Working> & { source: Source }) {
  const copy = enrollmentWithdrawWords[language];
  const [saving, setSaving] = useState(false),
    [frozen, setFrozen] = useState(initiallyFrozen),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(false);
  // The shell only saves a registered working draft; this form has no editable values.
  useEffect(() => {
    onDraftChange?.({});
    onDirtyChange?.(true);
  }, [onDraftChange, onDirtyChange]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !enabled || (!frozen && !confirmed)) return;
    setError(false);
    setSaving(true);
    if (freezeAfterAttempt) setFrozen(true);
    try {
      await onSave({});
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      autoComplete="off"
      noValidate
      onSubmit={submit}
      aria-label={copy.title}
    >
      <p>
        {copy.project}: {source.projectId}
      </p>
      <p>
        {copy.farmer}: {source.farmerId}
      </p>
      <p>
        {copy.version}: {source.version}
      </p>
      {error && <p role="alert">{copy.failed}</p>}
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
        disabled={saving || !enabled || (!frozen && !confirmed)}
      >
        {saving ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
