"use client";
import { useEffect, useState } from "react";
import { PilotWorkspace } from "../components/pilot-workspace";
import { LocaleProvider, useLocale } from "@agri/i18n/react";
export default function Home() {
  return (
    <LocaleProvider initial="si">
      <FieldHome />
    </LocaleProvider>
  );
}
function FieldHome() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [language, chooseLanguage] = useLocale();
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  // The workspace renders the whole page: the sign-in layout when signed out and
  // the task home (language switch, network state, title) when signed in.
  return (
    <PilotWorkspace
      language={language}
      online={online}
      onLanguageChange={chooseLanguage}
    />
  );
}
