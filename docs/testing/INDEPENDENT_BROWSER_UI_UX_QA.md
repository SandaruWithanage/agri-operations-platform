# Independent Chromium QA and UI/UX evidence

## Purpose

The independent browser QA workflow is additive to `.github/workflows/ci.yml`. It runs for new or updated pull requests targeting `main`, pushes to `main`, and manual `workflow_dispatch` runs. It must **not** be treated as independent approval of client security, real-device GPS accuracy, or production readiness.

Workflow: `.github/workflows/independent-browser-qa.yml`  
Runner: `tests/browser/qa-ui-ux.mjs`  
Evidence: Actions artifact `independent-browser-ui-ux` containing `report.json`, PNG screenshots, and Playwright `*-trace.zip` files.

## Tests and environments

- Clean, compiled production builds of both Next.js apps, started on loopback-only dynamic ports.
- Existing PostgreSQL 17/PostGIS integration suite and preexisting compiled-browser regression suite, with synthetic data.
- Chromium page checks at 1440x900, 390x844 and 320x740 for admin and field home/login flows.
- Additional Sinhala mobile layout/locale check.
- Synthetic, authorized field land-selection screen at desktop and mobile widths, including geolocation start and loss-of-session redaction.
- Fail the job on JavaScript errors, missing visible input labels, main document horizontal overflow, or broken critical interactions.
- Report visible controls under 44px as **advisory** issues. Some inline links/buttons may pass WCAG target-size spacing exceptions, so this list needs review rather than automatic rejection.
- Record Chromium screenshots and interaction traces to enable visual and failure review. No golden images or screenshot-diff approval baseline is asserted.

## How to inspect

1. Open **Actions → Independent Browser QA (UI/UX)** for the desired commit/PR.
2. Check the `Chromium UI/UX and regression evidence` job result.
3. Download the `independent-browser-ui-ux` artifact from the run summary.
4. Inspect `report.json` for failed scenarios, page errors, overflow and touch-target warnings.
5. Review the PNGs at desktop/mobile sizes for typography, visual hierarchy, Sinhala rendering, responsive tables, density, contrast, missing states and obvious layout problems.
6. To replay a trace, install the repo's pinned dependencies locally and use `pnpm exec playwright show-trace <trace-zip>`.

## Security and coverage boundaries

All authenticated responses inside the new UI/UX smoke script are **synthetic Playwright route fixtures**, including the land data and survey session. The workflow must never collect screenshots/traces from live client or farmer accounts, commit production secrets, or upload raw PII. Repository PRs and fork contributions receive no additional secrets.

The existing database integration tests exercise a real disposable PostGIS instance. UI screenshot tests use mock API responses and cannot by themselves prove end-to-end database authorization, production login, offline recovery, survey accuracy on physical phones, screen-reader quality, WCAG compliance or objective design quality. These require separate audits, user testing and security gates.

## Extending the suite

- Add deterministic synthetic scenarios for every substantial new admin or field route.
- Cover English and Sinhala labels, loading/empty/error/success states, and desktop/mobile before declaring a workflow done.
- Include keyboard-only navigation, form focus/error state, status announcements and zoom/reflow checks for high-risk pages.
- Consider an approved axe-core/Playwright accessibility gate after defining a baseline and false-positive/waiver policy.
- Keep accessibility and visual screenshots reviewable in PRs, and never silently bless a failed test by turning it into a warning.
