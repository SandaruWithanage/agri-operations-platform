"use client";
import { applicationName } from "@agri/ui";
import { useEffect, useState } from "react";
import { PilotWorkspace } from "../components/pilot-workspace";
import { copy } from "@agri/i18n";
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
  const c = copy[language];
  return (
    <main>
      <p className="kicker">
        {applicationName} • {c.role}
      </p>
      <div
        style={{ display: "flex", gap: 8, marginBottom: 24 }}
        aria-label="Language"
      >
        <button
          aria-pressed={language === "en"}
          onClick={() => chooseLanguage("en")}
        >
          English
        </button>
        <button
          aria-pressed={language === "si"}
          onClick={() => chooseLanguage("si")}
        >
          සිංහල
        </button>
      </div>
      {online !== null && (
        <p role="status">{online ? c.networkOnline : c.networkOffline}</p>
      )}
      <div className="card">
        <h1>{c.title}</h1>
        <PilotWorkspace language={language} />
      </div>
    </main>
  );
}
