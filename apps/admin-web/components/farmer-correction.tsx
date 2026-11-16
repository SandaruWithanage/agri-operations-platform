"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
import { farmerChangeSchema, type FarmerChange } from "@agri/validation";
import { createProtectedQueryClient } from "../lib/protected-query";
import {
  beforeGeography,
  readCorrectionContext,
  type CorrectionOwner,
  type CorrectionSource,
} from "../lib/correction-context";
import { correctionWords } from "./correction-words";
export const correctionReviewReason =
  "Staff corrected the displayed farmer name and configured geography after review.";
export const correctionIdleMs = 300000;
export type CorrectionDraft = CorrectionOwner & {
  id: number;
  client: PilotClient;
  source: CorrectionSource;
  boundaryEpoch: number;
};
type Props = {
  draft: CorrectionDraft;
  activeClient: PilotClient;
  boundaryEpoch: number;
  language: "en" | "si";
  registerLock: (lock: () => void) => () => void;
  onSaved: () => void;
  onDiscard: () => void;
  onFailure: (error: unknown) => void;
  onIdle: () => void;
  idleMs?: number;
};
type Submitted = Extract<FarmerChange, { action: "correction" }>;
export function FarmerCorrection(props: Props) {
  const [queries] = useState(createProtectedQueryClient);
  return (
    <QueryClientProvider client={queries}>
      <CorrectionForm {...props} />
    </QueryClientProvider>
  );
}
function CorrectionForm({
  draft,
  activeClient,
  boundaryEpoch,
  language,
  registerLock,
  onSaved,
  onDiscard,
  onFailure,
  onIdle,
  idleMs = correctionIdleMs,
}: Props) {
  const copy = correctionWords[language],
    queries = useQueryClient();
  const region = useRef<HTMLElement | null>(null);
  const [name, setName] = useState(draft.source.fullName),
    [geography, setGeography] = useState(draft.source.geographyId);
  const [confirmed, setConfirmed] = useState(false);
  const [locked, setLocked] = useState(
    () => document.visibilityState === "hidden",
  );
  const lockedRef = useRef(locked),
    active = useRef(true),
    generation = useRef(0);
  const [epoch, setEpoch] = useState(0),
    [unavailable, setUnavailable] = useState(false);
  const [after, setAfter] = useState<string | undefined>(() =>
    beforeGeography(draft.source.geographyId),
  );
  const [frozen, setFrozen] = useState<Submitted | null>(null),
    submitted = useRef<Submitted | null>(null);
  const transport = useRef(activeClient);
  transport.current = activeClient;
  const boundary = useRef(boundaryEpoch);
  boundary.current = boundaryEpoch;
  const approvedBoundary = useRef(draft.boundaryEpoch);
  const resets = useRef<() => void>(() => {}),
    discardAbort = useRef<AbortController | null>(null);
  const callbacks = useRef({ onSaved, onDiscard, onFailure, onIdle });
  callbacks.current = { onSaved, onDiscard, onFailure, onIdle };
  const compatible = activeClient === draft.client;
  const canDisplay =
    !locked && compatible && boundaryEpoch === approvedBoundary.current;
  const lock = useCallback(
    (failed = false) => {
      if (failed) setUnavailable(true);
      // Even an already locked form can have a discard-identity read in flight.
      // Every protected transition must invalidate it before any confirmation.
      lockedRef.current = true;
      generation.current++;
      setLocked(true);
      setConfirmed(false);
      discardAbort.current?.abort();
      void queries.cancelQueries();
      queries.clear();
      resets.current();
    },
    [queries],
  );
  const validOperation = (attempt: number) =>
    active.current &&
    transport.current === draft.client &&
    boundary.current === approvedBoundary.current &&
    generation.current === attempt &&
    document.visibilityState !== "hidden";
  const proof = useQuery({
    queryKey: [
      "protected",
      {
        accountId: draft.accountId,
        deviceId: draft.deviceId,
        authorizationEpoch: epoch,
      },
      "farmer-correction-context",
      draft.source.id,
      draft.source.geographyId,
      { after: after ?? null, limit: 50 },
    ],
    enabled: canDisplay,
    queryFn: async ({ signal }) => {
      const value = await readCorrectionContext(
        draft.client,
        draft,
        draft.source,
        after,
        signal,
      );
      signal.throwIfAborted();
      if (!validOperation(epoch) || lockedRef.current)
        throw new PilotRequestError(401);
      return value;
    },
  });
  const mutation = useMutation({
    mutationKey: [
      "protected",
      {
        accountId: draft.accountId,
        deviceId: draft.deviceId,
        authorizationEpoch: epoch,
      },
      "farmer-correction",
      draft.source.id,
      draft.source.version,
    ],
    mutationFn: async (input: { attempt: number; change: Submitted }) => {
      if (!validOperation(input.attempt) || lockedRef.current)
        throw new PilotRequestError(401);
      return draft.client.changeFarmer(
        draft.accountId,
        input.change,
        draft.deviceId,
      );
    },
    onSuccess: (_result, input) => {
      if (validOperation(input.attempt) && !lockedRef.current)
        callbacks.current.onSaved();
    },
    onError: (error, input) => {
      if (!validOperation(input.attempt) || lockedRef.current) return;
      if (
        error instanceof PilotRequestError &&
        [401, 403, 404].includes(error.status)
      ) {
        lock(true);
        callbacks.current.onFailure(error);
      }
    },
  });
  const discard = useMutation({
    mutationKey: [
      "protected",
      { accountId: draft.accountId, deviceId: draft.deviceId },
      "discard-online-correction",
      draft.id,
    ],
    mutationFn: async (attempt: number) => {
      if (!validOperation(attempt)) throw new PilotRequestError(401);
      const controller = new AbortController();
      discardAbort.current = controller;
      const identity = await draft.client.sessionIdentity(controller.signal);
      controller.signal.throwIfAborted();
      if (
        identity.accountId !== draft.accountId ||
        identity.deviceId !== draft.deviceId ||
        !validOperation(attempt)
      )
        throw new PilotRequestError(401);
      return attempt;
    },
    onSuccess: (attempt) => {
      if (validOperation(attempt) && window.confirm(copy.discardConfirm)) {
        lock();
        callbacks.current.onDiscard();
      }
    },
    onError: (error, attempt) => {
      if (validOperation(attempt)) {
        lock(true);
        callbacks.current.onFailure(error);
      }
    },
  });
  resets.current = () => {
    mutation.reset();
    discard.reset();
  };
  useEffect(() => {
    active.current = true;
    region.current?.focus();
    const unregister = registerLock(() => lock());
    const hidden = () => {
      if (document.visibilityState === "hidden") lock();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active.current = false;
      unregister();
      discardAbort.current?.abort();
      void queries.cancelQueries();
      queries.clear();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [lock, queries, registerLock]);
  useEffect(() => {
    if (!compatible || boundaryEpoch !== approvedBoundary.current) lock();
  }, [compatible, boundaryEpoch, lock]);
  useEffect(() => {
    if (canDisplay && proof.isError) {
      const error = proof.error;
      lock(true);
      callbacks.current.onFailure(error);
    }
  }, [canDisplay, proof.isError, proof.error, lock]);
  useEffect(() => {
    let timer: number | undefined;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!lockedRef.current) {
          lock();
          callbacks.current.onIdle();
        }
      }, idleMs);
    };
    reset();
    window.addEventListener("pointerdown", reset, { passive: true });
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [idleMs, lock, epoch]);
  const dirty =
    name !== draft.source.fullName ||
    geography !== draft.source.geographyId ||
    frozen !== null;
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function resume() {
    if (
      transport.current !== draft.client ||
      document.visibilityState === "hidden"
    )
      return;
    generation.current++;
    approvedBoundary.current = boundary.current;
    lockedRef.current = false;
    setLocked(false);
    setUnavailable(false);
    setConfirmed(false);
    setAfter(beforeGeography(submitted.current?.geographyId ?? geography));
    setEpoch(generation.current);
    region.current?.focus();
  }
  const data =
    canDisplay && !proof.isFetching && !proof.isError ? proof.data : undefined;
  const eligible =
    data?.choices.geographies.some((value) => value.id === geography) === true;
  const changed =
    data !== undefined && data.current.version !== draft.source.version;
  const validName = name.trim().length > 0 && name.trim().length <= 200;
  const changedValues =
    name.trim() !== draft.source.fullName ||
    geography !== draft.source.geographyId;
  const saving = mutation.isPending,
    discarding = discard.isPending;
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (
      !data ||
      !canDisplay ||
      lockedRef.current ||
      saving ||
      discarding ||
      !eligible
    )
      return;
    if (!submitted.current) {
      if (
        !confirmed ||
        !validName ||
        !changedValues ||
        changed ||
        draft.source.version >= 2147483647
      )
        return;
      submitted.current = farmerChangeSchema.parse({
        mutationId: crypto.randomUUID(),
        farmerId: draft.source.id,
        expectedVersion: draft.source.version,
        action: "correction",
        fullName: name,
        geographyId: geography,
        reason: correctionReviewReason,
      }) as Submitted;
      setName(submitted.current.fullName);
      setFrozen(submitted.current);
    }
    mutation.mutate({ attempt: generation.current, change: submitted.current });
  }
  function page(cursor: string | undefined) {
    if (saving || discarding) return;
    setAfter(cursor);
    setConfirmed(false);
  }
  const showLocked = !canDisplay;
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="correction-editor"
      aria-label={copy.title}
    >
      <h2>{showLocked ? copy.locked : copy.title}</h2>
      <p>{copy.notice}</p>
      {showLocked ? (
        <>
          <p>{copy.lockNotice}</p>
          {!compatible && <p role="status">{copy.transport}</p>}
          {unavailable && <p role="alert">{copy.unavailable}</p>}
          <button disabled={!compatible || discarding} onClick={resume}>
            {copy.resume}
          </button>
        </>
      ) : (
        <>
          {proof.isFetching && <p role="status">{copy.loading}</p>}
          {data && (
            <form autoComplete="off" onSubmit={submit}>
              <p>
                {copy.currentName}: {data.current.fullName}
              </p>
              <p>
                {copy.currentLocation}: {data.current.geographyName}
              </p>
              <p>{copy.stateNotice}</p>
              {data.current.duplicateRisk && (
                <p role="status">{copy.duplicate}</p>
              )}
              {changed && <p role="alert">{copy.version}</p>}
              <label>
                {copy.name}
                <input
                  autoComplete="off"
                  value={name}
                  required
                  maxLength={200}
                  readOnly={frozen !== null}
                  disabled={saving || discarding}
                  onChange={(event) => {
                    if (submitted.current) return;
                    setName(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                {copy.location}
                <select
                  value={eligible ? geography : ""}
                  required
                  disabled={frozen !== null || saving || discarding}
                  onChange={(event) => {
                    if (submitted.current) return;
                    setGeography(event.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="" disabled>
                    {copy.choose}
                  </option>
                  {data.choices.geographies.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {!data.choices.geographies.length && (
                <p role="status">{copy.noLocations}</p>
              )}
              <div className="actions">
                <button
                  type="button"
                  disabled={saving || discarding}
                  onClick={() => page(undefined)}
                >
                  {copy.first}
                </button>
                <button
                  type="button"
                  disabled={saving || discarding}
                  onClick={() => page(beforeGeography(geography))}
                >
                  {copy.selected}
                </button>
                <button
                  type="button"
                  disabled={!data.choices.nextCursor || saving || discarding}
                  onClick={() => page(data.choices.nextCursor ?? undefined)}
                >
                  {copy.more}
                </button>
              </div>
              {!frozen && (
                <>
                  <label className="review-confirmation">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={saving || discarding}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    {copy.confirm}
                  </label>
                  <button
                    type="submit"
                    disabled={
                      !confirmed ||
                      !validName ||
                      !eligible ||
                      !changedValues ||
                      changed ||
                      draft.source.version >= 2147483647 ||
                      saving ||
                      discarding
                    }
                  >
                    {copy.submit}
                  </button>
                </>
              )}
              {frozen && <p>{copy.fixed}</p>}
              {saving && <p role="status">{copy.saving}</p>}
              {mutation.isError && (
                <p role="alert">
                  {mutation.error instanceof PilotRequestError &&
                  mutation.error.status === 409
                    ? copy.conflict
                    : !(mutation.error instanceof PilotRequestError) ||
                        mutation.error.status >= 500
                      ? copy.uncertain
                      : copy.failure}
                </p>
              )}
              {frozen &&
                !saving &&
                !(
                  mutation.error instanceof PilotRequestError &&
                  mutation.error.status === 409
                ) && (
                  <button type="submit" disabled={!eligible || discarding}>
                    {copy.retry}
                  </button>
                )}
            </form>
          )}
        </>
      )}
      <button
        disabled={!compatible || saving || discarding}
        onClick={() => {
          lock();
          approvedBoundary.current = boundary.current;
          discard.mutate(generation.current);
        }}
      >
        {copy.discard}
      </button>
      {discarding && <p role="status">{copy.discarding}</p>}
    </section>
  );
}
