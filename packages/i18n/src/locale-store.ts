import { createStore } from "zustand/vanilla";
import type { Language } from "./index";
export const localePreferenceKey = "agri-language";
export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "si";
}
type LocaleState = {
  language: Language;
  setLanguage: (value: Language) => void;
};
/** One store per mounted workspace; no module-global user state or browser I/O. */
export function createLocaleStore(initial: Language) {
  return createStore<LocaleState>()((set) => ({
    language: initial,
    setLanguage(value) {
      if (isLanguage(value)) set({ language: value });
    },
  }));
}
