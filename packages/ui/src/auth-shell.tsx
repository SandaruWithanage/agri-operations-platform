import type { ReactElement, ReactNode } from "react";

/**
 * Sign-in frame shared by the admin web and the field PWA (issue #71).
 *
 * Desktop: a dark brand panel beside the sign-in card. Narrow screens: a compact
 * brand bar above a single column, so the form is reached without scrolling past
 * marketing text. Nothing here stores or transmits anything; it only lays out the
 * form the app passes in, so sign-in behaviour stays in each app.
 */
export function AuthShell(props: {
  brandName: string;
  brandTagline: string;
  /** Short reassurance lines shown beside the form on wide screens only. */
  points: readonly string[];
  skipLabel: string;
  title: string;
  intro?: string;
  /** Language switch, rendered top right. */
  toolbar: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}): ReactElement {
  return (
    <div className="agri-auth">
      <a className="agri-skip" href="#agri-auth-main">
        {props.skipLabel}
      </a>
      <div className="agri-auth__brand">
        <p className="agri-brand">
          <span className="agri-brand__mark" aria-hidden="true" />
          {props.brandName}
        </p>
        <p className="agri-auth__tagline">{props.brandTagline}</p>
        <ul className="agri-auth__points">
          {props.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
      <main id="agri-auth-main" className="agri-auth__main">
        <div className="agri-auth__toolbar">{props.toolbar}</div>
        <div className="agri-auth__card">
          <h1>{props.title}</h1>
          {props.intro ? (
            <p className="agri-auth__intro">{props.intro}</p>
          ) : null}
          {props.children}
        </div>
        {props.footer ? (
          <div className="agri-auth__footer">{props.footer}</div>
        ) : null}
      </main>
    </div>
  );
}
