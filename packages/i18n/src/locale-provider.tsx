"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import type { Language } from "./index";
import {
  createLocaleStore,
  isLanguage,
  localePreferenceKey,
} from "./locale-store";
const LocaleContext = createContext<ReturnType<
  typeof createLocaleStore
> | null>(null);
export function LocaleProvider({
  initial,
  children,
}: {
  initial: Language;
  children: ReactNode;
}) {
  const [store] = useState(() => createLocaleStore(initial));
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(localePreferenceKey);
      if (isLanguage(saved)) store.getState().setLanguage(saved);
    } catch {
      /* Persistence is optional; in-memory switching remains available. */
    }
    document.documentElement.lang = store.getState().language;
    let external = false;
    const unsubscribe = store.subscribe((state) => {
      document.documentElement.lang = state.language;
      if (!external) {
        try {
          window.localStorage.setItem(localePreferenceKey, state.language);
        } catch {
          /* Never persist another store or block the interface on storage failure. */
        }
      }
    });
    const receive = (event: StorageEvent) => {
      if (event.key !== localePreferenceKey && event.key !== null) return;
      try {
        if (
          event.storageArea !== null &&
          event.storageArea !== window.localStorage
        )
          return;
      } catch {
        return;
      }
      const language = event.newValue === null ? initial : event.newValue;
      if (!isLanguage(language)) return;
      external = true;
      try {
        store.getState().setLanguage(language);
      } finally {
        external = false;
      }
    };
    window.addEventListener("storage", receive);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", receive);
    };
  }, [initial, store]);
  return (
    <LocaleContext.Provider value={store}>{children}</LocaleContext.Provider>
  );
}
export function useLocale() {
  const store = useContext(LocaleContext);
  if (!store) throw new Error("LocaleProvider is required");
  const language = useStore(store, (state) => state.language);
  return [language, store.getState().setLanguage] as const;
}
