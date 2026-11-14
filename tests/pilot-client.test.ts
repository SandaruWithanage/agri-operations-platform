// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PilotClient } from "../apps/field-pwa/lib/pilot-client";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const csrfToken = `${"B".repeat(43)}.${"C".repeat(43)}`;
const input = {
  mutationId: "f7e0c8bc-3dcb-4be7-ab63-d80f4099220a",
  farmer: {
    farmerId: "06149451-4004-4a23-a5a2-64a24e485a82",
    geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    fullName: "Synthetic farmer",
    privacyNoticeProvided: true as const,
  },
};
describe("browser registration transport", () => {
  it("reauthenticates on retry and sends the same mutation after an ambiguous network failure", async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
      .mockResolvedValueOnce(
        Response.json({ status: "synced", farmerId: input.farmer.farmerId }),
      );
    const client = new PilotClient(network);
    await expect(client.register(accountId, input)).rejects.toMatchObject({
      status: 503,
    });
    await client.register(accountId, input);
    expect(network.mock.calls.map((call) => call[0])).toEqual([
      "/api/pilot/auth/csrf",
      "/api/pilot/farmers/register",
      "/api/pilot/auth/csrf",
      "/api/pilot/farmers/register",
    ]);
    const options = network.mock.calls[1][1];
    expect(options.body).toBe(network.mock.calls[3][1].body);
    expect(options.credentials).toBe("same-origin");
    expect(options.cache).toBe("no-store");
    expect(options.headers["x-csrf-token"]).toBe(csrfToken);
    expect(options.headers.authorization).toBeUndefined();
  });
  it("never sends an old registration from another authenticated account", async () => {
    const network = vi
      .fn()
      .mockResolvedValue(
        Response.json({ accountId: input.farmer.farmerId, csrfToken }),
      );
    await expect(
      new PilotClient(network).register(accountId, input),
    ).rejects.toMatchObject({ status: 403 });
    expect(network).toHaveBeenCalledOnce();
  });
  it("preserves the error on a revoked session and rejects mismatched successful responses", async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const client = new PilotClient(network);
    await expect(client.register(accountId, input)).rejects.toMatchObject({
      status: 401,
    });
    network
      .mockResolvedValueOnce(Response.json({ accountId, csrfToken }))
      .mockResolvedValueOnce(
        Response.json({ status: "synced", farmerId: accountId }),
      );
    await expect(client.register(accountId, input)).rejects.toMatchObject({
      status: 503,
    });
  });
});
