/**
 * Typed mirror of `tokens.css` (issue #71, step 3). The CSS file is what the apps
 * import; this object exists so code and tests can reason about the same values.
 * tests/design-tokens.test.ts fails if the two drift apart.
 */
export const colors = {
  bg: "#f5f7f5",
  surface: "#ffffff",
  text: "#172b28",
  textMuted: "#355b4f",
  link: "#16724e",
  brand: "#16724e",
  border: "#e0e7e2",
  divider: "#b6c8bd",
  inputBorder: "#355b4f",
  controlBorder: "#255a40",
  controlText: "#143c2c",
  statusBg: "#e4f3ea",
  statusText: "#103c32",
  dangerText: "#7f1d1d",
  tableHeadBg: "#e2eee6",
  pressedBg: "#cfe8da",
  focus: "#1d4ed8",
  forest: "#103c32",
  surfacePale: "#edf4f0",
  navMuted: "#b7c6c1",
  textSubtle: "#5f706b",
  warningText: "#a05f17",
  warningBg: "#fff2dc",
  focusOnDark: "#9dc4ff",
} as const;

export const radii = {
  card: "14px",
  status: "9px",
  control: "6px",
  controlLarge: "8px",
} as const;

export const tapTargets = { min: 44, comfortable: 48 } as const;

export type ColorToken = keyof typeof colors;
