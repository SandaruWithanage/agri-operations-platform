import type { ReactElement, ReactNode } from "react";

export type PillTone = "draft" | "pending" | "verified" | "inactive";

/**
 * Small status label (issue #71). The status is always written out as text, so
 * colour is never the only cue; the tone only changes the background.
 */
export function StatusPill(props: {
  tone: PillTone;
  children: ReactNode;
}): ReactElement {
  return (
    <span className={`agri-pill agri-pill--${props.tone}`}>
      {props.children}
    </span>
  );
}
