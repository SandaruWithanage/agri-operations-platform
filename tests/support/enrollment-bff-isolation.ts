import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { expect } from "vitest";
import { digestSessionSecret } from "../../apps/api/src/authentication/session-cookie";

type Browser = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<Response>;

export async function verifyEnrollmentBffIsolation(
  db: pg.Client,
  accounts: [string, string],
  origin: string,
  handler: (request: Request) => Promise<Response>,
) {
  const organization = randomUUID();
  const makeSession = async (account: string) => {
    const device = randomUUID();
    const session = randomUUID();
    const opaque = randomBytes(32).toString("base64url");
    const request = (path: string, csrf?: string, body?: unknown) =>
      handler(
        new Request(new URL("/api/pilot/" + path, origin), {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin,
            cookie: "__Host-agri_session=" + opaque,
            ...(csrf ? { "x-csrf-token": csrf } : {}),
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    await db.query(
      "INSERT INTO authn.device(id,account_id,state,approved_at) VALUES($1,$2,'approved',now())",
      [device, account],
    );
    await db.query(
      "INSERT INTO authn.login_session(id,account_id,device_id,device_required,cookie_secret_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,true,$4,now()+interval '1 hour',now()+interval '1 day')",
      [session, account, device, digestSessionSecret(opaque)],
    );
    const response = await request("auth/csrf");
    expect(response.status).toBe(200);
    const csrf = await response.json();
    expect(csrf).toMatchObject({ accountId: account, deviceId: device });
    const browser: Browser = (path, _method, body) =>
      request(path, csrf.csrfToken, body);
    return { browser, request };
  };
  // Fresh sessions keep unrelated integration requests out of this test's budgets.
  const first = await makeSession(accounts[0]);
  const second = await makeSession(accounts[1]);
  const browsers = [first.browser, second.browser];
  await db.query(
    "INSERT INTO farm.organization(id,name) VALUES($1,'Synthetic enrollment BFF organization')",
    [organization],
  );
  const scopes = [];
  for (const account of accounts) {
    const projectId = randomUUID(),
      farmerId = randomUUID(),
      geographyId = randomUUID(),
      assignment = randomUUID();
    await db.query(
      "INSERT INTO farm.geography(id,organization_id,name) VALUES($1,$2,'Synthetic enrollment BFF village')",
      [geographyId, organization],
    );
    await db.query(
      "INSERT INTO farm.farmer(id,geography_id,full_name,privacy_notice_provided,registration_source,created_by) VALUES($1,$2,'Synthetic enrollment BFF farmer',true,'administrator',$3)",
      [farmerId, geographyId, account],
    );
    await db.query(
      "INSERT INTO operations.project(id,organization_id,name,active,created_by) VALUES($1,$2,'Synthetic enrollment BFF project',true,$3)",
      [projectId, organization, account],
    );
    await db.query(
      "INSERT INTO operations.enrollment_policy(project_id,enabled,eligible_farmer_statuses) VALUES($1,true,ARRAY['pending-review'])",
      [projectId],
    );
    // Give both actors farmer visibility across the fixture organization so denial
    // specifically demonstrates the project and geography intersection.
    await db.query(
      "INSERT INTO authz.permission_grant(id,account_id,organization_id,permission,coverage,starts_at) VALUES(gen_random_uuid(),$1,$2,'farmer.read','organization',now()-interval '1 hour')",
      [account, organization],
    );
    await db.query(
      "INSERT INTO authz.project_permission_grant(id,account_id,organization_id,project_id,permission,registration_source,starts_at) VALUES(gen_random_uuid(),$1,$2,$3,'enrollment.read',NULL,now()-interval '1 hour'),(gen_random_uuid(),$1,$2,$3,'enrollment.create','administrator',now()-interval '1 hour')",
      [account, organization, projectId],
    );
    await db.query(
      "INSERT INTO authz.project_assignment(id,account_id,organization_id,project_id,geography_id,starts_at) VALUES($1,$2,$3,$4,$5,now()-interval '1 hour')",
      [assignment, account, organization, projectId, geographyId],
    );
    scopes.push({
      projectId,
      farmerId,
      assignment,
      enrollmentId: randomUUID(),
      mutationId: randomUUID(),
    });
  }
  const command = ({
    projectId,
    farmerId,
    enrollmentId,
    mutationId,
  }: (typeof scopes)[number]) => ({
    projectId,
    farmerId,
    enrollmentId,
    mutationId,
  });
  const enroll = "enrollments/enroll";
  expect(
    (await second.request(enroll, undefined, command(scopes[1]))).status,
  ).toBe(403);
  for (const [i, own] of scopes.entries()) {
    const saved = await browsers[i](enroll, "POST", command(own));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      enrollmentId: own.enrollmentId,
      version: 1,
      replayed: false,
    });
  }
  for (const [i, own] of scopes.entries()) {
    const other = scopes[1 - i],
      browser = browsers[i];
    const page = await browser("enrollments?projectId=" + own.projectId);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.json()).toMatchObject({
      accountId: accounts[i],
      items: [{ id: own.enrollmentId }],
      nextCursor: null,
    });
    const hidden = await browser("enrollments?projectId=" + other.projectId);
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({
      accountId: accounts[i],
      items: [],
      nextCursor: null,
    });
    const ownDetail = await browser(
      "enrollments/detail?id=" + own.enrollmentId,
    );
    expect(ownDetail.status).toBe(200);
    expect(await ownDetail.json()).toMatchObject({
      accountId: accounts[i],
      enrollment: { id: own.enrollmentId },
    });
    expect(
      (await browser("enrollments/detail?id=" + other.enrollmentId)).status,
    ).toBe(404);
    for (const target of [
      command(other),
      { ...command(own), farmerId: other.farmerId },
    ]) {
      const attempt = {
        ...target,
        enrollmentId: randomUUID(),
        mutationId: randomUUID(),
      };
      expect((await browser(enroll, "POST", attempt)).status).toBe(403);
      expect(
        (
          await db.query(
            "SELECT id FROM operations.enrollment_mutation WHERE id=$1",
            [attempt.mutationId],
          )
        ).rowCount,
      ).toBe(0);
    }
  }
  await db.query(
    "UPDATE authz.project_assignment SET active=false WHERE id=$1",
    [scopes[1].assignment],
  );
  expect(
    (await second.browser("enrollments/detail?id=" + scopes[1].enrollmentId))
      .status,
  ).toBe(404);
  expect(
    (await second.browser(enroll, "POST", command(scopes[1]))).status,
  ).toBe(403);
  expect(
    (await first.browser("enrollments/detail?id=" + scopes[0].enrollmentId))
      .status,
  ).toBe(200);
}
