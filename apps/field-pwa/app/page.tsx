"use client";
import { applicationName } from "@agri/ui";
import { useEffect, useState } from "react";
import { copy } from "@agri/i18n";
export default function Home() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [language, setLanguage] = useState<"en" | "si">("si");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("agri-language");
      if (saved === "en" || saved === "si") setLanguage(saved);
    } catch {
      /* Language switching still works when storage is unavailable. */
    }
  }, []);
  function chooseLanguage(value: "en" | "si") {
    setLanguage(value);
    try {
      window.localStorage.setItem("agri-language", value);
    } catch {
      /* Optional persistence. */
    }
  }
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
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
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
        <p>{c.description}</p>
        <p className="status" role="status">
          {c.warning}
        </p>
        <p>{c.step}</p>
      </div>
    </main>
  );
}
