"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
import { createProtectedQueryClient } from "../lib/protected-query";
export const creationIdleMs = 300000;
export type CreationOwner = { accountId: string; deviceId: string };
export type CreationDraft = CreationOwner & {
  id: number;
  client: PilotClient;
  boundaryEpoch: number;
};
type CreationOption = { id: string; label: string };
export type CreationFormProps<W, R> = {
  language: "en" | "si";
  options: readonly CreationOption[];
  enabled?: boolean;
  freezeAfterAttempt?: boolean;
  initiallyFrozen?: boolean;
  initialDraft?: W;
  onDraftChange?: (value: W) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (value: R) => Promise<void>;
};
export type CreationAdapter<W, R, S> = {
  key: string;
  selection: (working: W) => string | undefined;
  read: (
    client: PilotClient,
    owner: CreationOwner,
    selection: string | undefined,
    signal: AbortSignal,
    pendingRequest: S | null,
  ) => Promise<{ options: CreationOption[] }>;
  request: (record: R) => S;
  submit: (
    client: PilotClient,
    owner: CreationOwner,
    request: S,
  ) => Promise<unknown>;
  Form: ComponentType<CreationFormProps<W, R>>;
};
export type CreationCopy = {
  title: string;
  notice: string;
  locked: string;
  retained: string;
  unavailable: string;
  resume: string;
  loading: string;
  rules: string;
  fixed: string;
  conflict: string;
  discard: string;
  discarding: string;
  discardConfirm: string;
};
type Props<W, R, S> = {
  adapter: CreationAdapter<W, R, S>;
  copy: CreationCopy;
  draft: CreationDraft;
  activeClient: PilotClient;
  boundaryEpoch: number;
  language: "en" | "si";
  registerLock: (lock: () => void) => () => void;
  onSaved: (request: S) => void;
  onDiscard: () => void;
  onFailure: (error: unknown) => void;
  onIdle: () => void;
  idleMs?: number;
};
/** Tab-only draft boundaries; domain adapters retain their own strict protocol and permissions. */
export function OnlineCreation<W, R, S>(props: Props<W, R, S>) {
  const [queries] = useState(createProtectedQueryClient);
  return (
    <QueryClientProvider client={queries}>
      <RegistrationForm {...props} />
    </QueryClientProvider>
  );
}
function RegistrationForm<W, R, S>({
  adapter,
  copy,
  draft,
  activeClient,
  boundaryEpoch,
  language,
  registerLock,
  onSaved,
  onDiscard,
  onFailure,
  onIdle,
  idleMs = creationIdleMs,
}: Props<W, R, S>) {
  const queries = useQueryClient();
  const region = useRef<HTMLElement | null>(null);
  const working = useRef<W | undefined>(undefined);
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
  const submitted = useRef<S | null>(null);
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
      adapter.key,
      "context",
    ],
    enabled: canDisplay,
    queryFn: async ({ signal }) => {
      const value = await adapter.read(
        draft.client,
        draft,
        working.current ? adapter.selection(working.current) : undefined,
        signal,
        submitted.current,
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
      adapter.key,
      "submit",
      draft.id,
    ],
    mutationFn: async (input: { attempt: number; request: S }) => {
      if (!validOperation(input.attempt) || lockedRef.current)
        throw new PilotRequestError(401);
      return adapter.submit(draft.client, draft, input.request);
    },
    onSuccess: (_result, input) => {
      if (validOperation(input.attempt) && !lockedRef.current)
        callbacks.current.onSaved(input.request);
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
      adapter.key,
      "discard",
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
  async function save(record: R) {
    if (
      !data ||
      !canDisplay ||
      lockedRef.current ||
      saving ||
      discarding ||
      conflict ||
      !working.current ||
      !adapter.selection(working.current) ||
      !data.options.some(
        (value) =>
          working.current && value.id === adapter.selection(working.current),
      )
    )
      throw new PilotRequestError(403);
    submitted.current ??= adapter.request(record);
    setFrozen(true);
    const attempt = generation.current;
    await mutation.mutateAsync({ attempt, request: submitted.current });
    // A response arriving after lock cannot clear the retained draft or report success.
    if (!validOperation(attempt) || lockedRef.current)
      throw new PilotRequestError(401);
  }
  const Form = adapter.Form;
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
              <Form
                key={epoch}
                language={language}
                options={data.options}
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
