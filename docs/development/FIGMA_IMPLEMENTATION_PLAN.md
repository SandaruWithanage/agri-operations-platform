# Front-end build from the Figma base design

Status: **living plan.** The owner supplied a Figma file as a **base, not a finished specification**, and asked for a simple, clean, modern interface built screen by screen on what the back end already provides. Where the base has a problem, this plan improves it and records why, so the owner can reverse any choice. Nothing here changes a business rule, an authorization rule or a security control.

## Sources

| What                                                               | Figma file key           | Use                                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agricultural Operations Platform, UX Architecture and Core Screens | `GJZ8HcRYzqy8EIpvQuP6Iu` | The base for the admin and field screens (15 frames).                                                                                               |
| Agriculture, Farm Landing (Free Figma Template, Community)         | `W6bSBTR238ebO4WmpoCcDB` | **Kept for later.** Use it if a public landing page is ever needed. Not built: a public page is outside the Phase 1 staff scope (no farmer portal). |

## Principles

1. **Simple, clean, modern.** Few colours, generous spacing, one primary action per screen, no decoration that does not help someone work.
2. **Connected to the real back end.** Every screen uses the existing BFF routes and `PilotClient` methods. No mock numbers, names or counts. Where no data source exists the screen says so honestly (for example "Not available yet").
3. **Never mock completion.** A module that is not built is shown as a clearly labelled disabled item, never as a working page.
4. **Same behaviour, new look.** Fields, labels, security attributes, offline behaviour, permissions and audit are unchanged; tests pin them.
5. **Accessible by default.** WCAG AA contrast (tested), 44 px touch targets (measured in a real browser), visible keyboard focus, one `h1` and one `main` per screen, skip link, no horizontal scroll from 320 px.

## Screens in the base design and what we build

| #      | Frame in the base design                                                                     | Built today?                                             | Plan                                                                                                |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| –      | **Sign-in** (not in the base)                                                                | Yes, admin web and field PWA: **done in stages 1 and 2** | Designed in the same language for both apps. The field page shows the real online or offline state. |
| 01     | Admin / Overview                                                                             | No overview; counts have no endpoint                     | Build with live data where an endpoint exists, honest "not available" elsewhere.                    |
| 02     | Admin / Farmer Registry                                                                      | Yes (list, filters, review queue)                        | Restyle inside the new shell.                                                                       |
| 03     | Admin / Land Map                                                                             | Land list and detail only; **no map**                    | Restyle the land list. The map waits for ADR 0023 acceptance and the DEC-09 tile licence.           |
| 07     | Admin / Farmer 360 Profile                                                                   | Farmer detail, history, correction, verification         | Restyle inside the shell.                                                                           |
| 08     | Admin / Project Enrollment                                                                   | Yes (policy, enroll, withdraw, directory)                | Restyle; enrollment sits under Projects in the base, kept as its own item until then.               |
| 04, 09 | Officer / Home (offline, Sinhala)                                                            | Field home and encrypted offline workspace               | Task-first home with real online, offline and sync states.                                          |
| 05, 10 | Officer / Farmer Registration                                                                | Yes (offline-capable registration)                       | Restyle, behaviour unchanged.                                                                       |
| 11     | Officer / Land Capture (Sinhala)                                                             | Walk-the-perimeter survey (online)                       | Restyle the existing survey screens.                                                                |
| 12, 13 | Officer / Review, Saved Offline                                                              | Review of the saved record; offline states               | Restyle with the real saved, pending, synced, conflict and rejected states.                         |
| 06     | Officer / Sync Center                                                                        | Sync state exists inside the offline workspace           | A small status area first; a full sync centre only if the data supports it.                         |
| –      | Navigation items Field Operations, Resources, Agreements, Planning, People & Access, Reports | **Not built** (some deferred by the owner)               | Shown as disabled "Planned" items, never as pages.                                                  |

## Deliberate deviations from the base (each reversible)

| Change                                                                    | Why                                                                                                                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muted text `#677a74` becomes `#5f706b`                                    | The base value is 4.23:1 on its own page background and 4.08:1 on pale surfaces; AA needs 4.5:1. The new value is 4.56:1 or better everywhere and looks the same. |
| Warning tag text `#a56218` becomes `#a05f17`                              | 4.35:1 on the soft orange background; the new value is 4.58:1.                                                                                                    |
| Light focus ring on dark surfaces                                         | The standard blue ring is 1.83:1 on the dark green sidebar, so keyboard focus would be nearly invisible. A light ring is 6.87:1.                                  |
| Sinhala switch shows the full word "සිංහල" instead of the single glyph "සි" | One glyph is easy to misread and fails to render where font coverage is thin. The visible text now equals the accessible name.                                    |
| Controls are 44 to 48 px tall                                             | The base's 34 to 39 px controls are below the project's touch-target rule, which matters for field use.                                                           |
| The brand shown is the configured application name, not "FIELDROOT"       | Branding and naming are an open client decision (DEC-01); the base's name is a placeholder.                                                                       |
| No "2,760 planned farmers" and no sample project names                    | The 2,760 versus 2,700 planning discrepancy is unresolved (DEC-10), and sample data must never look real.                                                         |
| Inline SVG icons instead of Unicode symbols (next stage)                  | Symbol glyphs vary by device font and read badly to screen readers.                                                                                               |
| Record navigation is hidden until signed in                               | The base design shows the shell only for a signed-in user; the old screen showed tabs with no access behind them.                                                 |

## Sign-in (stages 1 and 2)

- The base design has no sign-in, so it is designed here: a dark brand panel beside a white card on desktop, a compact brand bar above one column on phones.
- **Unchanged:** the four fields (account name, password, authenticator code, approved device ID), their labels and security attributes (`autocomplete`, `inputmode`, `pattern`, length limits), the sign-in button, the device-enrollment-request download and the session re-check.
- **Kept after a regression check:** the session re-check button, and the "shared filters are invalid" alert with its reset button, both of which also had to work while signed out.
- **Added:** short hints for the authenticator code and the device ID, a skip link, one heading, and the language switch.
- **Field PWA (stage 2):** same layout, mobile first. Extra, officer-specific: the device's real connection state ("Device is offline.") is shown at the top, the **encrypted offline workspace link stays directly under the form in every state** (checking, signed out, signed in), the device ID keeps its UUID pattern and the device-request button still validates it first. While the session is being checked the page shows the same layout with a status line instead of a different frame, so signed-out officers see no layout flash and the language switch is never replaced mid-click (a lost-click bug found during testing).
- Wording that tells staff what the system does ("changes are recorded in an audit trail", "you only see records your account is permitted to see") was written from what the back end actually does.

## Admin shell (stage 3)

- A dark sidebar (Farmers, Land, Projects, Enrollments with inline SVG icons and a current-page marker), a top bar with the language switch, and one `main`. On phones the sidebar becomes a scrolling bar above the page.
- Navigation uses `aria-current="page"` instead of `aria-pressed`, which is what screen readers announce as "current page".
- Modules that are not built (Field Operations, Resources, Agreements, Planning, People & Access, Reports) are listed as plain text with a "Planned" tag. They are not buttons or links, so nothing implies a working page. The modules listed are the base design's, not a promise of scope: several are deferred by the owner.
- Navigation items are not yet filtered by role. That waits on the DEC-02 role matrix; the database still decides access.
- Everything inside the page (filters, lists, forms, correction, withdrawal) is unchanged in this stage and is restyled in stage 5.

## Admin page content (stage 5, first part)

- Headings, buttons, tables, sections and the current-tab state inside the shell use the same tokens (rounded pale buttons, a bordered table card, quieter muted text). Presentation only: markup, behaviour and the 44 px minimum are unchanged and the real-browser run measures them at 1280, 390 and 320 px.
- **Overview page deferred, deliberately.** No endpoint returns counts or summaries; the existing lists are paginated and scoped by the database. A real overview needs a new, row-level-security-scoped aggregate endpoint, which is back-end and authorization work, not styling. Showing counts from one page of results, or sample numbers, would be misleading, so the Farmers page stays the landing page until that endpoint is designed and approved.
- Still to do in stage 5: restyle the forms (registration, correction, project and land creation) and the detail panels.

## Language

English and Sinhala. **The new Sinhala strings were written without a native-speaker review and must be reviewed before any pilot**, like the other Sinhala copy. Actual font rendering on approved phones needs device testing (DEC-07).

## Next stages (one pull request each)

1. ~~Admin sign-in~~ (done, merged).
2. ~~Field sign-in~~ (done, merged).
3. ~~Admin shell and navigation~~ with disabled "Planned" modules
4. Field home task states and the offline workspace screens.
5. Farmer registry, farmer profile, land list, projects and enrollments.
6. Officer registration, land capture, review and saved-offline screens.

Each stage is checked with unit tests, a real-browser run at desktop and phone widths, and the full CI. Passing checks is evidence, not design approval; the owner reviews the visuals.
