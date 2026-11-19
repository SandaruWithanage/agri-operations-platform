"use client";
import { PermissionAction } from "@agri/ui/permission-action";
import type { EnrollmentPage, EnrollmentDetail } from "@agri/validation";
import { enrollmentWithdrawWords, enrollmentWords } from "./enrollment-words";
type Summary = EnrollmentDetail["enrollment"];
export function EnrollmentDirectory({
  language,
  page,
  detail,
  canBack,
  onOpen,
  onClose,
  onBack,
  onNext,
  onWithdraw,
  withdrawDisabled = false,
}: {
  language: "en" | "si";
  page?: EnrollmentPage;
  detail?: EnrollmentDetail;
  canBack: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onWithdraw?: (source: Summary) => void;
  withdrawDisabled?: boolean;
}) {
  const copy = enrollmentWords[language];
  const status = (value: Summary["status"]) =>
    value === "enrolled" ? copy.enrolled : copy.withdrawn;
  return (
    <>
      <p>{copy.notice}</p>
      <p>{copy.references}</p>
      {page && (
        <>
          {!page.items.length && <p role="status">{copy.empty}</p>}
          {!!page.items.length && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{copy.project}</th>
                    <th>{copy.farmer}</th>
                    <th>{copy.status}</th>
                    <th>{copy.enrolledAt}</th>
                    <th>{copy.detail}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.projectId}</td>
                      <td>{item.farmerId}</td>
                      <td>{status(item.status)}</td>
                      <td>
                        <time dateTime={item.enrolledAt}>
                          {item.enrolledAt}
                        </time>
                      </td>
                      <td>
                        <button
                          aria-label={`${copy.detail}: ${item.id}`}
                          onClick={() => onOpen(item.id)}
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
          <h2>{status(detail.enrollment.status)}</h2>
          <dl>
            <dt>{copy.project}</dt>
            <dd>{detail.enrollment.projectId}</dd>
            <dt>{copy.farmer}</dt>
            <dd>{detail.enrollment.farmerId}</dd>
            <dt>{copy.version}</dt>
            <dd>{detail.enrollment.version}</dd>
            <dt>{copy.enrolledAt}</dt>
            <dd>
              <time dateTime={detail.enrollment.enrolledAt}>
                {detail.enrollment.enrolledAt}
              </time>
            </dd>
            {detail.enrollment.withdrawnAt && (
              <>
                <dt>{copy.withdrawnAt}</dt>
                <dd>
                  <time dateTime={detail.enrollment.withdrawnAt}>
                    {detail.enrollment.withdrawnAt}
                  </time>
                </dd>
              </>
            )}
          </dl>
          {detail.enrollment.status === "enrolled" &&
            detail.enrollment.version < 2147483645 &&
            onWithdraw && (
              <PermissionAction
                code="enrollment.withdraw"
                disabled={withdrawDisabled}
                onClick={() => onWithdraw(detail.enrollment)}
              >
                {enrollmentWithdrawWords[language].start}
              </PermissionAction>
            )}
          <button onClick={onClose}>{copy.close}</button>
        </section>
      )}
    </>
  );
}
