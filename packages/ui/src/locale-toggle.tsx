import type { ReactElement } from "react";

export type Locale = "en" | "si";

/**
 * Compact EN | සිංහල language switch (Figma base design). English is shortened to
 * EN, but its accessible name stays "English". Sinhala is shown as the full word
 * rather than the design's single glyph "සි", which renders badly where Sinhala
 * font coverage is thin and is hard to recognise; the visible text equals the
 * accessible name (WCAG 2.5.3).
 */
export function LocaleToggle(props: {
  value: Locale;
  onChange: (locale: Locale) => void;
  /** Accessible name of the group, in the current language. */
  label: string;
}): ReactElement {
  const options: ReadonlyArray<{
    locale: Locale;
    visible: string;
    name: string;
  }> = [
    { locale: "en", visible: "EN", name: "English" },
    { locale: "si", visible: "සිංහල", name: "සිංහල" },
  ];
  return (
    <div role="group" aria-label={props.label} className="agri-locale">
      {options.map((option) => (
        <button
          key={option.locale}
          type="button"
          lang={option.locale}
          aria-label={option.name}
          aria-pressed={props.value === option.locale}
          onClick={() => props.onChange(option.locale)}
        >
          {option.visible}
        </button>
      ))}
    </div>
  );
}
