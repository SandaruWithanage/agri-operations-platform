# UI development rules

Status: **standing rules from the owner (19 Nov 2026).** They apply to every screen in the admin web and the field PWA. They do not change any business rule, authorization rule or security control; where a rule needs back-end work that is not approved, this file says so.

## Rule 1. Shared components first

- Build and reuse components in `@agri/ui` (shell, sign-in layout, language switch, status pill, buttons, form controls, notices, permission action). Do not copy a pattern into an app, and do not restyle a control inline.
- Colours, radii, spacing and touch sizes come only from `@agri/design-tokens`. A test already fails on hard-coded colours in app CSS.
- A second use of a pattern is the moment to move it into `@agri/ui`, with a component test.

## Rule 2. Frosted glass surface language

**One blur layer per hierarchy.** A glass surface inside another glass surface keeps its translucent background but is never backdrop-filtered again (issue 101). `tests/browser/glass-layers.mjs` builds nested surfaces from the real stylesheets in Chromium and fails if any descendant of a filtered surface has its own backdrop filter, at phone and desktop widths and with more contrast requested (where every surface must be solid and unfiltered).

- Shared **glass** tokens and one `.agri-glass` surface class live in `@agri/design-tokens` and `@agri/ui`. Apps never write their own blur.
- Glass is for chrome and cards (sidebar, top bar, sign-in card, summary cards, dialogs). Dense reading areas, such as tables and long forms, use a high-opacity glass so text stays readable.
- **Readability beats effect.** Text on glass must keep WCAG AA contrast (4.5:1) measured against the **worst-case** background behind it. The token test computes this and fails if a glass colour is too transparent.
- Fallbacks are required: a solid surface where `backdrop-filter` is unsupported, and a solid surface when the user prefers reduced transparency. Sinhala text and outdoor sunlight on cheap phones are the reference conditions.
- **Status: implemented** (19 Nov 2026): `--agri-glass-*` and `--agri-backdrop` tokens, the shared glass selector list in `@agri/ui/ui.css`, solid and reduced-transparency fallbacks, and the worst-case contrast tests in `tests/design-tokens.test.ts`.
- Keep blur small and never nest blurred layers (it costs battery and frame rate on low-end phones, which the field app must support).

## Rule 3. Every action is permission-driven

- Every button, link or control that creates, changes, verifies, withdraws, exports or signs out is rendered through one shared `PermissionAction` component and declares a **permission code** from one registry (for example `farmer.verify`, `enrollment.withdraw`, `project.update`). The codes are the ones PostgreSQL already defines.
- Removing a permission from an account must remove or disable the matching control everywhere without a code change. No role names are hard-coded in components.
- **The interface is a convenience, not the control.** PostgreSQL still decides every request (row-level security, grants, audit). A hidden button is never a security check, and every action still handles a "denied" response from the server.
- When the capability list is not known, the component must not guess "allowed" silently: it renders the action, marked as server-checked, and the server's answer decides.

### Validation of Rule 3 against the system today (19 Nov 2026, corrected)

- Permissions are enforced in PostgreSQL, but grants store the permission as **free text** (`authz.permission_grant.permission`). There is no permission table and no permission id.
- **Owner direction (19 Nov 2026): permission is handled in the database layer, as a permission id.** The proposal (catalog with stable ids, grants and role bindings referencing them, a database mapping from screen actions to permission ids, and a read-only capabilities function) is recorded as an addendum to [ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md). It is **proposed, not approved, and not built**: it changes the authorization schema, so it needs the DEC-02 answers and the security review first.
- **What the front end receives today:** the signed session context has no permission list, but some record responses carry **server-computed flags** from `authz.allowed(...)`: farmer detail returns `correct`, `verify` and `viewAudit`, project detail returns `edit`. Create, enrollment and policy actions have no flag yet, so those buttons show for everyone signed in and the server answers 403 when someone is not allowed. (An earlier version of this note said no permission data reached the front end; that was incomplete.)
- **Capabilities endpoint:** the proposed API, BFF and database contract (candidate scopes, `held` and `unknown` states, isolation, cache invalidation, tests) is in [CAPABILITIES_ENDPOINT_CONTRACT.md](../security/CAPABILITIES_ENDPOINT_CONTRACT.md). It is for review (revision 2, 19 Nov 2026, still PROPOSED); nothing in the interface changes until C2 is reviewed and tested and C3 is built. C3 retires the interim "permissions unknown shows everything" mode: after it, a failed or expired check means a restricted, recoverable view, never every action.
- **Built now:** the shared `PermissionAction`, a registry of permission codes (every code is checked against the database migrations), the "permissions unknown" mode, support for the server's record-level flags (a "no" from either source wins), and guards that fail if a consequential action is rendered as a raw button or uses an unregistered code. When the capabilities function exists, giving the provider the list turns gating on everywhere; the key then becomes the permission id.

## Rule 4. Evidence

Each UI change adds or updates component tests, runs the real-browser layout checks, records the result in the handover and review log, and lists what was not done. Passing checks is evidence, not design approval.
