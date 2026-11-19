# UI development rules

Status: **standing rules from the owner (19 Nov 2026).** They apply to every screen in the admin web and the field PWA. They do not change any business rule, authorization rule or security control; where a rule needs back-end work that is not approved, this file says so.

## Rule 1. Shared components first

- Build and reuse components in `@agri/ui` (shell, sign-in layout, language switch, status pill, buttons, form controls, notices, permission action). Do not copy a pattern into an app, and do not restyle a control inline.
- Colours, radii, spacing and touch sizes come only from `@agri/design-tokens`. A test already fails on hard-coded colours in app CSS.
- A second use of a pattern is the moment to move it into `@agri/ui`, with a component test.

## Rule 2. Frosted glass surface language

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

### Validation of Rule 3 against the system today (19 Nov 2026)

- The database defines real permission codes (`farmer.read/create/verify/correct/audit.read`, `land.read/create/geometry.*`, `project.read/create/update`, `enrollment.read/create/policy/policy.set/withdraw`).
- **The front end is not given the signed-in account's permissions.** The session context carries only account ID, device ID, key fingerprint, expiry times and the permitted geographies. So today buttons appear for everyone signed in, and the server answers 403 for those not allowed.
- Therefore Rule 3 cannot be fully honoured by the interface alone. It needs a **read-only capabilities endpoint** that returns the actor's effective permission codes (and, later, scope). That endpoint reads authorization data, so it needs the owner's approval and a security review before it is built; the DEC-02 instruction not to change authorization code stays in force until then.
- What can be built now without that endpoint: the `PermissionAction` component, the permission-code registry, the "capabilities unknown" mode described above, and tests that every consequential action is registered. When the endpoint exists, switching the provider from "unknown" to the real list turns gating on everywhere.

## Rule 4. Evidence

Each UI change adds or updates component tests, runs the real-browser layout checks, records the result in the handover and review log, and lists what was not done. Passing checks is evidence, not design approval.
