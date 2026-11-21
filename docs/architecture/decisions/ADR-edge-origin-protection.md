# ADR (PROPOSED) — Provider-neutral edge and origin protection (SEC-A3)

**Status: PROPOSED. Not accepted, not implemented, not independently reviewed.** No hosting provider, production topology, proxy count or edge product is chosen or assumed (hosting decision OPS-04 is open; owner direction OWNER-S3, 19 Nov 2026). This ADR records requirements, a design option and a verification plan so that the hosting decision can be checked against them. Nothing here claims a deployment is secure or that Gate G1 or production security acceptance is complete.

Related: [Security baseline audit](../../security/SECURITY_BASELINE_AUDIT.md) (F-02, F-03, F-07, F-12), [Threat model](../../security/THREAT_MODEL_AUTOMATED_THREATS.md), [Pilot authentication runtime](../../development/PILOT_AUTH_RUNTIME.md), [Security events](../../security/SECURITY_EVENTS.md). It preserves the accepted [data, state and cache ADR](ADR-data-state-cache.md): PostgreSQL stays authoritative, and **no Redis is introduced** (any shared counter or distributed limit needs a demonstrated need and an architecture review).

## Why this is needed

Today's controls assume one process behind a known number of trusted proxy hops:

- The BFF derives the client address from `X-Forwarded-For` using `PILOT_TRUSTED_PROXY_HOPS`; zero hops puts every client in one bucket and needs an explicit acknowledgement (SEC-A1).
- Rate limits are process-local (F-03). Several instances multiply the budgets; a restart resets them.
- Nothing prevents a caller from reaching the BFF or API origin directly, bypassing any edge limit, filter or forwarded-header normalisation (F-02).

An edge that normalises headers and limits abuse is only a control if the origin cannot be reached around it.

## Requirements (provider-neutral)

Each requirement must be **demonstrated on the real topology**, not asserted from configuration.

| ID  | Requirement                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Single public entry.** Public traffic reaches the BFF only through the edge. The BFF and API origins have no other public listener or address.                                                                                                                              |
| R2  | **Origin isolation.** A request that does not come through the edge is refused at the network layer where possible (private networking, allow-list of edge sources) and, as defence in depth, at the application layer (see edge attestation).                                |
| R3  | **Known hop count.** The number of proxies between the client and the BFF is fixed, documented and equals `PILOT_TRUSTED_PROXY_HOPS`. A change in the chain is a change to the configuration, reviewed together.                                                              |
| R4  | **Forwarded-header normalisation.** The edge overwrites (never appends to) client-supplied forwarding headers, so a forged `X-Forwarded-For` cannot choose the address the BFF trusts.                                                                                        |
| R5  | **TLS.** Public traffic is HTTPS only with HSTS; edge-to-origin traffic is encrypted or on a private network; the database connection keeps `sslmode=verify-full` (already enforced for production).                                                                          |
| R6  | **Edge limits.** The edge applies coarse, per-client request and connection limits and request size and header limits ahead of the application, **in addition to** (not instead of) the application budgets. They are sized from SEC-A4 budgets, not guessed.                 |
| R7  | **No single defence.** CAPTCHA, User-Agent filtering, fingerprinting and IP bans are never the sole control (SEC-AUDIT-01). Any such edge feature is additive, must not lock out shared-NAT or slow-mobile field staff by itself, and has a documented bypass for operations. |
| R8  | **Observable.** The edge exposes request, refusal and limit counts the operator can see, and edge logs follow the same privacy rule as application events (no tokens, cookies, bodies or farmer data).                                                                        |
| R9  | **Fail closed on misconfiguration.** The application refuses to start on an unsafe production configuration (SEC-A1, merged) and, when edge attestation is enabled, refuses requests without a valid attestation.                                                             |
| R10 | **Provider portability.** Requirements are stated in terms of behaviour (overwrite, allow-list, limit), so any provider or self-hosted proxy that can be shown to meet them is acceptable.                                                                                    |

## Design option: edge attestation (OPTIONAL, defence in depth)

If the chosen topology cannot guarantee R2 at the network layer alone, the edge adds a secret header and the origin verifies it.

- The edge sets a header (for example `X-Edge-Attestation`) to a high-entropy secret that only the edge and the origin know. The BFF and API compare it in constant time with the configured value(s) and refuse the request (fail closed, generic 403, a security event with a fixed reason code) when it is missing or wrong.
- The secret is a managed secret under the same custody rules as the other keys (see the SEC-A2 hash-key requirement): never in the repository, a log, an error or a prompt. Two values are accepted during rotation so the edge can be switched without downtime.
- It is **not** a substitute for network isolation: a leaked secret, or an attacker who can reach the edge's internal path, defeats it. It also does not authenticate users, and it must never be used as an authorization input.
- Off by default; enabling it is a configuration decision tied to the hosting choice. When the hosting decision is made, the start-up check can require it for production.
- Not implemented here. Implementation would be a separate, small, production-affecting PR (SEC-A3b) needing explicit merge approval, tests (valid, missing, wrong, rotated, timing-safe comparison, no secret in any output, no change to responses when disabled) and mutation checks.

## Verification plan (to run on the real topology; authorized, synthetic, never against a live service without explicit authorization)

| ID  | Check                                                                                                                                                                                            | Evidence expected                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| V1  | From outside, resolve and probe every public address and port of the deployment: only the edge answers; origin addresses are closed or filtered (R1, R2).                                        | Port and address inventory with results                            |
| V2  | Send a request straight to each origin from outside the allowed network: refused (R2).                                                                                                           | Refusal at network or attestation layer                            |
| V3  | Send requests through the edge with forged `X-Forwarded-For` values (single, multiple, spaces, IPv6, very long): the BFF's derived client address ignores the forged part (R3, R4).              | Security events show the edge-observed address, not the forged one |
| V4  | Compare the number of hops observed in the real chain with `PILOT_TRUSTED_PROXY_HOPS` (R3).                                                                                                      | Documented chain and matching setting                              |
| V5  | Oversized headers, oversized bodies and slow bodies are cut off at the edge before the application (R6).                                                                                         | Edge refusal counts                                                |
| V6  | The application's start-up refusal (SEC-A1) is observed under the real process supervisor: exit status, restart behaviour, alert (SEC-A1 acceptance condition 4).                                | Supervisor logs and alert record                                   |
| V7  | A scripted burst from one synthetic client and from many synthetic clients behind one shared address: limits behave as the SEC-A4 budgets intend and do not lock out unrelated clients (R6, R7). | Counts per client; no cross-client lockout                         |
| V8  | No secret, cookie, token or farmer data appears in edge logs or security events (R8).                                                                                                            | Log sample review with planted synthetic markers                   |

These checks are **not run**: there is no deployment to run them against. They are the acceptance evidence the hosting decision must produce, together with the independent review (Gate G1 and OWNER-S6, S13: a qualified independent reviewer is not yet assigned).

## What this ADR does not decide

- The hosting provider, region, network layout, edge product or hop count.
- The final per-route budgets (SEC-A4) and login protection (SEC-A5, design on decision D3 option B).
- Whether edge attestation is used; it is an option, chosen with the topology.
- Incident-response ownership and alert recipients (pending assignment, OWNER-S5).

## Consequences

- Hosting proposals are reviewed against R1 to R10 and must supply V1 to V8 evidence before any production security acceptance is claimed.
- Until then the SEC-A1 acceptance conditions stay **not met**: a zero-hop configuration with the acknowledgement flag is not proof of a secure public deployment.
- Application-level budgets and events keep working unchanged; the edge adds coarse protection and does not remove them.
