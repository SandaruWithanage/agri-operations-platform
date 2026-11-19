"use client";
import { LocaleProvider, useLocale } from "@agri/i18n/react";
import { LocaleToggle } from "@agri/ui/locale-toggle";
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
    <main className="field-frame">
      <div className="field-frame__bar">
        <LocaleToggle
          value={language}
          onChange={chooseLanguage}
          label="Language / භාෂාව"
        />
      </div>
      <div className="card">
        <LandSurveyWorkspace language={language} />
      </div>
    </main>
  );
}
