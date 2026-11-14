// @vitest-environment node
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { FarmerRegistrationForm } from "../apps/field-pwa/components/farmer-registration-form";
import { RegistrationOutbox } from "../packages/sync-client/src";

const cryptoApi = webcrypto as unknown as Crypto;
const name = `synthetic-integration-${cryptoApi.randomUUID()}`;
const geography = {
  id: "4e743f19-e3f7-4ed0-bdcc-29fe8e71ff0d",
  label: "Synthetic village",
};
const outbox = new RegistrationOutbox(name, cryptoApi);
let cleanup = () => {};
afterEach(async () => {
  cleanup();
  outbox.close();
  vi.unstubAllGlobals();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

it("persists a minimal form submission locally and retries a pending mutation with the same ID", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  const testing = await import("@testing-library/react/pure");
  const { default: userEvent } = await import("@testing-library/user-event");
  cleanup = testing.cleanup;
  const { render, within } = testing;
  await outbox.initialize("synthetic-test-passphrase");
  const user = userEvent.setup({ document: dom.window.document });
  const screen = within(dom.window.document.body);
  render(
    <FarmerRegistrationForm
      language="en"
      geographies={[geography]}
      onSave={async (value) => {
        await outbox.saveDraft(value);
      }}
    />,
  );
  await user.type(screen.getByLabelText("Full name"), "Synthetic farmer");
  await user.selectOptions(
    screen.getByLabelText("GN division or village"),
    geography.id,
  );
  await user.click(
    screen.getByLabelText("I provided the required privacy notice"),
  );
  await user.click(screen.getByRole("button", { name: "Save registration" }));
  await vi.waitFor(async () => {
    expect(await outbox.list()).toHaveLength(1);
  });
  const [draft] = await outbox.list();
  expect(draft.status).toBe("saved-on-device");
  await outbox.queue(draft.id);
  const network = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ status: "synced" });
  await expect(outbox.syncPending(network)).rejects.toThrow("offline");
  await outbox.syncPending(network);
  expect(network.mock.calls[0][0]).toBe(draft.id);
  expect(network.mock.calls[1][0]).toBe(draft.id);
  expect((await outbox.list())[0].status).toBe("synced");
});
