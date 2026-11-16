"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
import type { FarmerRegistration, WorkingRegistration } from "@agri/validation";
import { FarmerRegistrationForm } from "@agri/ui/farmer-registration";
import { createProtectedQueryClient } from "../lib/protected-query";
import {
  readRegistrationContext,
  type RegistrationOwner,
} from "../lib/registration-context";
import { registrationWords } from "./registration-words";
export const registrationIdleMs = 300000;
export type RegistrationDraft = RegistrationOwner & {
  id: number;
  client: PilotClient;
  boundaryEpoch: number;
};
type Props = {
  draft: RegistrationDraft;
  activeClient: PilotClient;
  boundaryEpoch: number;
  language: "en" | "si";
  registerLock: (lock: () => void) => () => void;
  onSaved: (farmerId: string) => void;
  onDiscard: () => void;
  onFailure: (error: unknown) => void;
  onIdle: () => void;
  idleMs?: number;
};
type Submitted = { mutationId: string; farmer: FarmerRegistration };
export function FarmerRegistrationEditor(props: Props) {
  const [queries] = useState(createProtectedQueryClient);
  return (
    <QueryClientProvider client={queries}>
      <RegistrationForm {...props} />
    </QueryClientProvider>
  );
}
function RegistrationForm({
  draft,
  activeClient,
  boundaryEpoch,
  language,
  registerLock,
  onSaved,
  onDiscard,
  onFailure,
  onIdle,
  idleMs = registrationIdleMs,
}: Props) {
  const copy = registrationWords[language],
    queries = useQueryClient();
  const region = useRef<HTMLElement | null>(null);
  const working = useRef<WorkingRegistration | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [locked, setLocked] = useState(
    () => document.visibilityState === "hidden",
  );
  const lockedRef = useRef(locked),
    active = useRef(true),
    generation = useRef(0);
  const [epoch, setEpoch] = useState(0),
    [unavailable, setUnavailable] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const submitted = useRef<Submitted | null>(null);
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
      "farmer-registration-context",
    ],
    enabled: canDisplay,
    queryFn: async ({ signal }) => {
      const value = await readRegistrationContext(
        draft.client,
        draft,
        working.current?.geographyId || undefined,
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
      "farmer-registration",
      draft.id,
    ],
    mutationFn: async (input: { attempt: number; request: Submitted }) => {
      if (!validOperation(input.attempt) || lockedRef.current)
        throw new PilotRequestError(401);
      return draft.client.register(
        draft.accountId,
        input.request,
        draft.deviceId,
      );
    },
    onSuccess: (_result, input) => {
      if (validOperation(input.attempt) && !lockedRef.current)
        callbacks.current.onSaved(input.request.farmer.farmerId);
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
      "discard-online-registration",
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
  useEffect(() => {
    if (!dirty && !frozen) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, frozen]);
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
    setEpoch(generation.current);
    region.current?.focus();
  }
  const data =
    canDisplay && !proof.isFetching && !proof.isError ? proof.data : undefined;
  const saving = mutation.isPending,
    discarding = discard.isPending;
  const conflict =
    mutation.error instanceof PilotRequestError &&
    mutation.error.status === 409;
  async function save(farmer: FarmerRegistration) {
    if (
      !data ||
      !canDisplay ||
      lockedRef.current ||
      saving ||
      discarding ||
      conflict ||
      !data.geographies.some((value) => value.id === farmer.geographyId)
    )
      throw new PilotRequestError(403);
    submitted.current ??= { mutationId: crypto.randomUUID(), farmer };
    working.current = submitted.current.farmer;
    setFrozen(true);
    const attempt = generation.current;
    await mutation.mutateAsync({ attempt, request: submitted.current });
    // A response arriving after lock cannot clear the retained draft or report success.
    if (!validOperation(attempt) || lockedRef.current)
      throw new PilotRequestError(401);
  }
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="correction-editor"
      aria-label={copy.title}
    >
      <h2>{canDisplay ? copy.title : copy.locked}</h2>
      <p>{copy.notice}</p>
      {!canDisplay ? (
        <>
          <p>{copy.retained}</p>
          {unavailable && <p role="alert">{copy.unavailable}</p>}
          <button disabled={!compatible || discarding} onClick={resume}>
            {copy.resume}
          </button>
        </>
      ) : (
        <>
          {proof.isFetching && <p role="status">{copy.loading}</p>}
          {data && (
            <>
              <p>{copy.rules}</p>
              {frozen && <p role="status">{copy.fixed}</p>}
              {conflict && <p role="alert">{copy.conflict}</p>}
              <FarmerRegistrationForm
                key={epoch}
                language={language}
                geographies={data.geographies}
                enabled={!discarding && !conflict}
                freezeAfterAttempt
                initiallyFrozen={frozen}
                initialDraft={working.current}
                onDraftChange={(value) => {
                  working.current = value;
                }}
                onDirtyChange={setDirty}
                onSave={save}
              />
            </>
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
