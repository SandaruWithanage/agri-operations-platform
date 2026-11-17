"use client";
import { LocaleProvider, useLocale } from "@agri/i18n/react";
import { LandSurveyWorkspace } from "../../components/land-survey-workspace";
export default function LandSurveyPage() {
  return (
    <LocaleProvider initial="si">
      <SurveyHome />
    </LocaleProvider>
  );
}
function SurveyHome() {
  const [language, chooseLanguage] = useLocale();
  return (
    <main>
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
      <div className="card">
        <LandSurveyWorkspace language={language} />
      </div>
    </main>
  );
}
