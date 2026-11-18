# UX audit and wireframe proposal (issue #71, steps 1 and 2)

Status: **proposal for owner design review. No code, styling or behaviour changes.** Issue #71 says substantial navigation or workflow changes need owner approval first, so this document stops at wireframes and open questions. It is a heuristic review of the committed components (17 Nov 2026), not a usability study, and it does not claim the authenticated screens were screenshot-audited. Wireframes are text sketches for discussion, not final visual design.

## 1. Audit: what the code shows today

Observed in `apps/admin-web/components/farmer-registry.tsx` (about 1 470 lines) and `apps/field-pwa/components/pilot-workspace.tsx`, `app/page.tsx`:

### Admin web

| #   | Observation (verified in code)                                                                                                                                                      | Effect on the operator                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A1  | The language toggle and the four record tabs (Farmers, Land, Projects, Enrollments) render at the top of the page whether or not anyone is signed in.                               | Navigation appears before access exists; clicking it before sign-in has no purpose.  |
| A2  | One page-wide `main` (max width 900 px, centred) holds everything: tabs, heading, scope sentence, messages, actions, filters, list and detail.                                      | No application shell: no persistent identity, organization or location context.      |
| A3  | A single row of equal buttons holds Refresh, the register actions (project, land, farmer) and Sign out. Default button styling is shared by primary, secondary and session actions. | The primary action is not visually distinct; Sign out sits among creation actions.   |
| A4  | Feedback is a plain paragraph with `role="status"` or `role="alert"`; busy is a paragraph.                                                                                          | Messages are accessible but easy to miss and not attached to the field that failed.  |
| A5  | All four domains and their editing, correction, history and withdrawal flows live in one component.                                                                                 | Hard to evolve one task without touching the others (a maintenance risk, not a bug). |
| A6  | Tabs use `aria-pressed` buttons rather than a tab or navigation pattern with a current-page marker.                                                                                 | Screen-reader users get "pressed" instead of "current page".                         |

### Field PWA

| #   | Observation (verified in code)                                                                                                                                                                                                                                                                                                                                                                                                            | Effect on the officer                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| F1  | The home screen is one card: a kicker, language buttons (inline styles), a network sentence, then the title and the workspace. The workspace opens with a two-sentence notice, then two links, then (when signed out) a sign-in form that also carries a paragraph of setup text. _Corrected 18 Nov 2026: the first version of this audit called the notice "long"; it is two sentences. The real friction is the order, not the length._ | Technical and safety text is read before the main task.                                        |
| F2  | After sign-in the home shows the same two links (offline workspace, land survey) plus Retry and Sign out. There is no task list, no "Register farmer" entry on the home, no pending-sync count and no recent work.                                                                                                                                                                                                                        | The officer must know which page holds which job; sync state is not visible on arrival.        |
| F3  | The online and offline workspaces are separate pages with their own states.                                                                                                                                                                                                                                                                                                                                                               | The mental model "am I online or offline" is carried by the officer, not by the screen header. |
| F4  | Touch-target sizes were fixed in #74 and verified by the `field-touch-targets` browser check; language buttons and form controls follow the shared styles.                                                                                                                                                                                                                                                                                | Reasonable foundation; do not regress it.                                                      |

### Strengths to keep

Bilingual content with a language toggle, labelled inputs, large inputs and the no-horizontal-overflow checks, explicit offline and sync states in the offline workspace, and permission-aware empty states. The redesign must preserve all authorization, audit, idempotency, vault and privacy behaviour.

## 2. Proposed information architecture

### Admin (desktop first, tablet and phone supported)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Agri Ops   District / organization name        EN | සිං   User ▾    │  top bar: identity, language, sign out
├────────────┬─────────────────────────────────────────────────────────┤
│ Farmers    │  Farmers                          [ + Register farmer ] │  page title + ONE primary action
│ Land       │  Showing records in your assigned area                  │  scope sentence, only when signed in
│ Projects   │  [ search ] [ status ▾ ] [ division ▾ ]  [Reset]        │  filters
│ Enrollments│  ┌────────────────────────────────────────────────────┐ │
│            │  │ name · GN division · status badge · updated        │ │  compact list, one row per record
│            │  │ …                                                  │ │
│            │  └────────────────────────────────────────────────────┘ │
│            │  Empty / loading / error states in place of the list    │
└────────────┴─────────────────────────────────────────────────────────┘
Before sign-in: the shell shows only the sign-in card; no navigation.
```

- Left navigation (collapses to a menu button on phone) for Farmers, Land, Projects, Enrollments, with a current-page marker. Items appear only for domains the signed-in role may read (no mock functions for unauthorized users).
- One primary action per page in a fixed position; Refresh and Sign out become secondary, Sign out moves into the user menu.
- Record detail opens in a side panel (desktop) or its own page (phone) with a clear Back; correction, history and withdrawal stay as explicit secondary actions with confirmations.
- Counts and status summaries appear only where the role is authorized to see them.

### Field officer (phone first)

```
┌──────────────────────────────┐
│ Agri Ops          EN | සිං   │
│ ● Online   Last verified 09:42│  connection + verification state, always visible
│ Pending sync: 3               │  tappable, goes to the queue
├──────────────────────────────┤
│ [ Register farmer          ] │  large task buttons (≥ 48 px), one per job
│ [ Survey land (walk)       ] │
│ [ Pending and synced work  ] │
│ [ Offline workspace        ] │
├──────────────────────────────┤
│ Recent work                  │
│  · Farmer A — Saved on device │
│  · Land B — Synced            │
├──────────────────────────────┤
│ Help and safety notes ▸      │  the long limitation text moves behind a disclosure
│ Sign out                      │
└──────────────────────────────┘
Before sign-in: language, one sign-in form, and the setup help behind a disclosure.
```

- Offline entry points appear only when the vault is ready and the feature is enabled; offline **enrollment** stays off (ADR 0021 not accepted).
- The survey workflow keeps its current explicit steps, and the offline draft behaviour waits on ADR 0025.

## 3. Proposed design foundations (small, tokens first)

Spacing and type scale, a restrained palette meeting contrast requirements, one button hierarchy (primary, secondary, quiet, destructive), form control and focus styles, status badges (draft, pending review, verified, inactive; synced, pending, conflict, rejected), alert and toast patterns, dialog conventions, and responsive grids. Test with longer Sinhala strings; no external fonts, maps or analytics; no new storage or auto-save.

## 4. Top five staff journeys to demonstrate

1. Sign in and enrol an approved device.
2. Find a farmer and review the record (search, filters, detail).
3. Register a farmer and land.
4. Enrol or withdraw a farmer (withdrawal remains administrator-only).
5. Resume an offline draft and sync.

For each, the first implementation step records current friction with synthetic approved accounts and screenshots before any change. Any journey not yet implemented or gated is shown as such, not mocked.

## 5. Delivery plan (bounded PRs, each behind owner approval)

1. **Owner review of this document** (the gate).
2. Tokens and shared components in `@agri/ui` with no behaviour change; visual regression screenshots.
3. Admin shell and navigation; split the registry component by domain as part of it.
4. Field task home with sync state; existing pages unchanged underneath.
5. Workflow forms (grouping, inline validation, error summary and focus).
6. Accessibility audit and bilingual layout checks at 320, 390, 768 and 1440 px, 200 percent zoom, keyboard and screen reader.
7. A short session with real administrator and field-officer representatives, or a labelled synthetic-proxy review.

## 6. Questions for the owner

1. Approve the left-navigation admin shell and the task-first field home, or prefer another direction?
2. Which role sees which navigation items (this depends on the DEC-02 role matrix)?
3. Is a restrained agricultural palette acceptable, or is there brand guidance?
4. Should the field home show recent work (names are personal data, so this would list only status and opaque labels unless approved)?
5. Who can take part in the real-user session, and when?

## Owner response (18 Nov 2026, provisional)

OWNER-D1 in the [decision register](../requirements/OPEN_DECISIONS.md) adopts the layout direction. Question 1 (sidebar admin shell and task-first field home): **approved**. Question 3 (restrained agricultural palette): **approved**, no brand guidance supplied. Question 4 (recent work): **status and opaque labels only**, no personal data without authorization. Question 2 (role-specific navigation) **waits on DEC-02**. Question 5 (real-user session) is **open**. Steps 2 onward of the delivery plan may proceed as bounded PRs with no behaviour change.

**Figma base and build plan:** the owner's Figma file is now the base for the screens; the build plan, the deliberate deviations and the stage order are in [FIGMA_IMPLEMENTATION_PLAN.md](FIGMA_IMPLEMENTATION_PLAN.md).

**Delivery progress:** field home order (task links first when signed in, sign-in first when signed out, notice last, links reachable in every state) is done as a small PR with no behaviour change; step 2 (tokens) is done in `@agri/design-tokens` with a contrast and drift test and no change on screen; the admin shell, the field task home and the workflow forms (steps 3 to 5) are not started.

## Not decided here

Visual identity, the final component set, role-specific navigation, and anything about the Phase 2 farmer portal. Green CI will not prove visual quality; screenshots are evidence, not approval.
