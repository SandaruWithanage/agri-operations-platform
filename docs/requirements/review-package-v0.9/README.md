# Review package v0.9 (imported reference copies)

**Status: NOT CLIENT APPROVED.** These are the project owner's developer-side review documents, prepared 16 Nov 2026 and supplied on 17 Nov 2026 as `AOP_SRS_ARCHITECTURE_REVIEW_PACKAGE.zip`. They are imported here, unchanged except for automatic Markdown formatting, so requirements and decisions can be traced from the repository. Importing them does not approve anything: no client approval, independent security attestation, fixed fee or schedule, production suitability or acceptance of ADR 0021 or ADR 0022 is asserted by their presence.

## What is here

- `AOP_SRS_v0.9_REVIEW.md` — proposed first-release specification (FR/NFR IDs, owner decision trace, UAT list).
- `AOP_ARCHITECTURE_v0.9_REVIEW.md` — proposed technical design and risk register.
- `AOP_REQUIREMENTS_TRACEABILITY.csv`, `AOP_UAT_ACCEPTANCE_MATRIX.csv` — spreadsheet forms of the traceability and acceptance matrices.
- `source_decisions/` — the 71-item provisional owner decision register and the package author's GitHub reconciliation (its statements describe `main` as of 16 Nov 2026, before PRs #41–#55; they are not updated here).
- `assets/` — source Graphviz and rendered diagrams used by the architecture document.

The Word and PDF renderings of the same content were not imported (derived files). Their source text is the Markdown above.

## How to use them

- Treat them as a **proposed requirements register**. Where they disagree with accepted ADRs, `AGENTS.md` or the current code, record the conflict in [PHASE_1_SOURCE_CONFLICTS.md](../PHASE_1_SOURCE_CONFLICTS.md) and resolve it by an owner/client decision or an ADR; never silently pick one.
- Provisional owner decisions (Q1–Q71) are not client-approved scope. DEC-01 (legal entity and approvers), DEC-10 (the 2,700 versus 2,760 planning figure), acceptance parameters (GPS/area tolerance, overlap tolerance, survey-source hierarchy) and real-device evidence remain open.
- [REPOSITORY_ALIGNMENT_NOTES.md](REPOSITORY_ALIGNMENT_NOTES.md) lists where the delivered code differs from these documents.
- The documents contain no real farmer data, credentials or contact details (checked on import). Keep it that way.
