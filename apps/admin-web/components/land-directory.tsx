"use client";
import type { LandPage, LandDetail } from "@agri/validation";
export const landWords = {
  en: {
    tab: "Reported land",
    title: "Reported land directory",
    scope: "Only land allowed by your current read permissions is shown.",
    notice:
      "Reported points and areas identify land only. They do not establish ownership, legal boundaries or verified acreage.",
    label: "Land label",
    unlabelled: "Unlabelled land",
    geography: "GN division or village",
    gps: "GPS identification",
    noGps: "GPS not recorded",
    hasGps: "Point reported",
    open: "View land",
    close: "Close land",
    empty:
      "No land records are available within your current read permissions.",
    missing:
      "This land identification is not available within your current read permissions.",
    latitude: "Latitude",
    longitude: "Longitude",
    accuracy: "Reported accuracy (metres)",
    area: "Reported area (hectares)",
    absent: "Not reported",
    id: "Record ID",
    created: "Registered",
    next: "Next page",
    back: "Previous page",
  },
  si: {
    tab: "වාර්තා කළ ඉඩම්",
    title: "වාර්තා කළ ඉඩම් ලේඛනය",
    scope: "වත්මන් කියවීමේ අවසර යටතේ ඇති ඉඩම් පමණක් පෙන්වයි.",
    notice:
      "වාර්තා කළ ලක්ෂ්‍ය හා වපසරිය ඉඩම හඳුනාගැනීමට පමණි. ඒවා අයිතිය, නීතිමය මායිම් හෝ තහවුරු කළ වපසරිය සනාථ නොකරයි.",
    label: "ඉඩම් නාමය",
    unlabelled: "නම් නොකළ ඉඩම",
    geography: "ග්‍රාම නිලධාරී වසම හෝ ගම",
    gps: "GPS හඳුනාගැනීම",
    noGps: "GPS සටහන් කර නොමැත",
    hasGps: "ලක්ෂ්‍යයක් වාර්තා කර ඇත",
    open: "ඉඩම බලන්න",
    close: "ඉඩම වසන්න",
    empty: "වත්මන් කියවීමේ අවසර යටතේ ඉඩම් වාර්තා නොමැත.",
    missing: "වත්මන් කියවීමේ අවසර යටතේ මෙම ඉඩම් වාර්තාව ලබාගත නොහැක.",
    latitude: "අක්ෂාංශ",
    longitude: "දේශාංශ",
    accuracy: "වාර්තා කළ නිරවද්‍යතාව (මීටර්)",
    area: "වාර්තා කළ වපසරිය (හෙක්ටයාර)",
    absent: "වාර්තා කර නොමැත",
    id: "වාර්තා හැඳුනුම් අංකය",
    created: "ලියාපදිංචි දිනය",
    next: "ඊළඟ පිටුව",
    back: "පෙර පිටුව",
  },
} as const;
/** Presentation only: protected records stay in the parent's TanStack Query cache. */
export function LandDirectory({
  language,
  page,
  detail,
  canBack,
  onOpen,
  onClose,
  onBack,
  onNext,
}: {
  language: "en" | "si";
  page?: LandPage;
  detail?: LandDetail;
  canBack: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const copy = landWords[language];
  const land = detail?.land;
  return (
    <>
      <p>{copy.notice}</p>
      {land ? (
        <section aria-label={copy.open}>
          <h2>{land.label ?? copy.unlabelled}</h2>
          <dl>
            <dt>{copy.id}</dt>
            <dd>
              <code>{land.id}</code>
            </dd>
            <dt>{copy.geography}</dt>
            <dd>{land.geographyName}</dd>
            <dt>{copy.gps}</dt>
            <dd>{land.point ? copy.hasGps : copy.noGps}</dd>
            {land.point && (
              <>
                <dt>{copy.latitude}</dt>
                <dd>{String(land.point.latitude)}</dd>
                <dt>{copy.longitude}</dt>
                <dd>{String(land.point.longitude)}</dd>
                <dt>{copy.accuracy}</dt>
                <dd>
                  {land.point.accuracyM === null
                    ? copy.absent
                    : String(land.point.accuracyM)}
                </dd>
              </>
            )}
            <dt>{copy.area}</dt>
            <dd>
              {land.reportedAreaHectares === null
                ? copy.absent
                : String(land.reportedAreaHectares)}
            </dd>
            <dt>{copy.created}</dt>
            <dd>
              {new Date(land.createdAt).toLocaleString(
                language === "si" ? "si-LK" : "en-GB",
              )}
            </dd>
          </dl>
          <button onClick={onClose}>{copy.close}</button>
        </section>
      ) : (
        <>
          {!page?.items.length ? (
            <p role="status">{copy.empty}</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{copy.label}</th>
                    <th scope="col">{copy.geography}</th>
                    <th scope="col">{copy.gps}</th>
                    <th scope="col">{copy.open}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((record) => (
                    <tr key={record.id}>
                      <td>{record.label ?? copy.unlabelled}</td>
                      <td>{record.geographyName}</td>
                      <td>{record.point ? copy.hasGps : copy.noGps}</td>
                      <td>
                        <button
                          onClick={() => onOpen(record.id)}
                          aria-label={`${copy.open}: ${record.label ?? copy.unlabelled} (${record.id})`}
                        >
                          {copy.open}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="actions">
            <button disabled={!canBack} onClick={onBack}>
              {copy.back}
            </button>
            <button disabled={!page?.nextCursor} onClick={onNext}>
              {copy.next}
            </button>
          </div>
        </>
      )}
    </>
  );
}
