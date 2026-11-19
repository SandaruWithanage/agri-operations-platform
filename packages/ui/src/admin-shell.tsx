import type { ReactElement, ReactNode } from "react";

export type ShellIcon = "farmers" | "land" | "projects" | "enrollments";

const iconPaths: Record<ShellIcon, string> = {
  farmers: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8a8 8 0 0 1 16 0",
  land: "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7Zm6-3v13m6-10v13",
  projects: "M4 7h16v12H4V7Zm5 0V5h6v2",
  enrollments: "M9 12l2 2 4-4M5 4h14v16H5V4Z",
};

function Icon(props: { name: ShellIcon }): ReactElement {
  return (
    <svg
      className="agri-shell__icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={iconPaths[props.name]} />
    </svg>
  );
}

export type ShellItem = {
  id: string;
  /** Section heading this item is listed under. */
  group: string;
  label: string;
  icon: ShellIcon;
  current: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * Signed-in frame for the admin web (issue #71): a dark sidebar, a top bar and one
 * `main`. Modules that are not built are listed as plain text with a "Planned" tag,
 * never as buttons or links, so nothing implies a working page. The shell only
 * lays out what the app passes in; access decisions stay in the app and the
 * database.
 */
export function AdminShell(props: {
  brandName: string;
  navLabel: string;
  items: readonly ShellItem[];
  plannedHeading: string;
  plannedTag: string;
  planned: readonly string[];
  skipLabel: string;
  toolbar: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="agri-shell">
      <a className="agri-skip" href="#agri-shell-main">
        {props.skipLabel}
      </a>
      <aside className="agri-shell__side">
        <p className="agri-brand">
          <span className="agri-brand__mark" aria-hidden="true" />
          {props.brandName}
        </p>
        <nav aria-label={props.navLabel}>
          {[...new Set(props.items.map((item) => item.group))].map((group) => (
            <div key={group} className="agri-shell__group">
              <p className="agri-shell__group-title">{group}</p>
              <ul className="agri-shell__nav">
                {props.items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="agri-shell__link"
                        aria-current={item.current ? "page" : undefined}
                        disabled={item.disabled}
                        onClick={item.onSelect}
                      >
                        <Icon name={item.icon} />
                        {item.label}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="agri-shell__planned">
          <p className="agri-shell__planned-title">{props.plannedHeading}</p>
          <ul>
            {props.planned.map((label) => (
              <li key={label}>
                {label} <span>{props.plannedTag}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="agri-shell__body">
        <div className="agri-shell__top">{props.toolbar}</div>
        <main id="agri-shell-main" className="agri-shell__main">
          {props.children}
        </main>
      </div>
    </div>
  );
}
