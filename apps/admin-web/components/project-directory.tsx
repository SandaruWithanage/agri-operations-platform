"use client";
import type { ProjectPage, ProjectDetail } from "@agri/validation";
import { projectEditWords } from "./project-edit-words";
import { projectWords } from "./project-words";
import { enrollmentPolicyWords } from "./enrollment-policy-words";
export function ProjectDirectory({
  language,
  page,
  detail,
  canBack,
  onOpen,
  onClose,
  onBack,
  onNext,
  onEdit,
  editDisabled = false,
  onPolicy,
}: {
  language: "en" | "si";
  page?: ProjectPage;
  detail?: ProjectDetail;
  canBack: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onEdit?: (source: ProjectDetail["project"]) => void;
  editDisabled?: boolean;
  onPolicy?: (source: ProjectDetail["project"]) => void;
}) {
  const copy = projectWords[language];
  return (
    <>
      <p>{copy.notice}</p>
      {page && (
        <>
          {!page.items.length && <p role="status">{copy.empty}</p>}
          {!!page.items.length && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{copy.name}</th>
                    <th>{copy.organization}</th>
                    <th>
                      {language === "en" ? "Catalog status" : "නාමාවලි තත්ත්වය"}
                    </th>
                    <th>{copy.created}</th>
                    <th>{copy.detail}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((project) => (
                    <tr key={project.id}>
                      <td>{project.name}</td>
                      <td>{project.organizationName}</td>
                      <td>{project.active ? copy.enabled : copy.disabled}</td>
                      <td>
                        <time dateTime={project.createdAt}>
                          {project.createdAt}
                        </time>
                      </td>
                      <td>
                        <button
                          aria-label={`${copy.detail}: ${project.name}`}
                          onClick={() => onOpen(project.id)}
                        >
                          {copy.detail}
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
            <button disabled={!page.nextCursor} onClick={onNext}>
              {copy.next}
            </button>
          </div>
        </>
      )}
      {detail && (
        <section aria-label={copy.detail}>
          <h2>{detail.project.name}</h2>
          <dl>
            <dt>{copy.organization}</dt>
            <dd>{detail.project.organizationName}</dd>
            <dt>{language === "en" ? "Catalog status" : "නාමාවලි තත්ත්වය"}</dt>
            <dd>{detail.project.active ? copy.enabled : copy.disabled}</dd>
            <dt>{copy.created}</dt>
            <dd>
              <time dateTime={detail.project.createdAt}>
                {detail.project.createdAt}
              </time>
            </dd>
          </dl>
          {detail.access?.edit === true && onEdit && (
            <button
              disabled={editDisabled || detail.project.version >= 2147483647}
              onClick={() => onEdit(detail.project)}
            >
              {projectEditWords[language].start}
            </button>
          )}
          {onPolicy && (
            <button
              disabled={editDisabled}
              onClick={() => onPolicy(detail.project)}
            >
              {enrollmentPolicyWords[language].start}
            </button>
          )}
          <button onClick={onClose}>{copy.close}</button>
        </section>
      )}
    </>
  );
}
