# @agri/design-tokens

Shared design tokens for the admin web and the field PWA (issue #71, step 3).

- `src/tokens.css` holds the CSS custom properties (`--agri-color-*`, `--agri-radius-*`, `--agri-tap-*`). Both apps import it from their `globals.css`: `@import "@agri/design-tokens/tokens.css";`.
- `src/index.ts` is a typed mirror (`colors`, `radii`, `tapTargets`) for code and tests.
- Adopting the tokens changed no value on screen: every token equals the literal both apps used before.

## Rules

1. Do not type a colour, radius or touch-target size into an app stylesheet. Add or change a token here instead.
2. Keep `tokens.css` and `index.ts` identical. `tests/design-tokens.test.ts` fails when they differ.
3. The same test checks WCAG AA contrast for every text, link, status and focus pairing (4.5:1 for text, 3:1 for the focus ring and control borders) and that neither app contains a hard-coded hex colour.
4. Touch targets stay at 44 px minimum and 48 px comfortable (`--agri-tap-min`, `--agri-tap-comfortable`). `tests/field-navigation-links.test.tsx` resolves the tokens and enforces this for the field navigation.

Passing contrast and size checks is evidence, not design approval; visual quality needs the owner's review.
