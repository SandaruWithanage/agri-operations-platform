import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LocaleProvider,
  useLocale,
} from "../packages/i18n/src/locale-provider";
import {
  createLocaleStore,
  localePreferenceKey,
} from "../packages/i18n/src/locale-store";
function Selector({ name = "one" }: { name?: string }) {
  const [language, choose] = useLocale();
  return (
    <div>
      <output aria-label={name}>{language}</output>
      <button onClick={() => choose(language === "en" ? "si" : "en")}>
        {name} toggle
      </button>
    </div>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("shares locale across consumers without remounting or translating entered form values", async () => {
  render(
    <LocaleProvider initial="en">
      <Selector />
      <Selector name="two" />
      <input aria-label="Synthetic form" defaultValue="" />
    </LocaleProvider>,
  );
  await userEvent.type(
    screen.getByLabelText("Synthetic form"),
    "Synthetic entered name",
  );
  await userEvent.click(screen.getByRole("button", { name: "one toggle" }));
  expect(screen.getByLabelText("one").textContent).toBe("si");
  expect(screen.getByLabelText("two").textContent).toBe("si");
  expect(
    (screen.getByLabelText("Synthetic form") as HTMLInputElement).value,
  ).toBe("Synthetic entered name");
  expect(document.documentElement.lang).toBe("si");
  expect(localStorage.getItem(localePreferenceKey)).toBe("si");
  expect(Object.keys(localStorage)).toEqual([localePreferenceKey]);
});
it("hydrates the legacy raw-string preference without writing on mount", () => {
  localStorage.setItem(localePreferenceKey, "en");
  const write = vi.spyOn(Storage.prototype, "setItem");
  render(
    <LocaleProvider initial="si">
      <Selector />
    </LocaleProvider>,
  );
  expect(screen.getByLabelText("one").textContent).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  expect(write).not.toHaveBeenCalled();
});
it("ignores malformed values and unrelated keys", () => {
  localStorage.setItem(
    localePreferenceKey,
    '{"language":"en","farmer":"Synthetic forbidden record"}',
  );
  render(
    <LocaleProvider initial="si">
      <Selector />
    </LocaleProvider>,
  );
  fireEvent(
    window,
    new StorageEvent("storage", { key: "session", newValue: "en" }),
  );
  fireEvent(
    window,
    new StorageEvent("storage", { key: localePreferenceKey, newValue: "fr" }),
  );
  expect(screen.getByLabelText("one").textContent).toBe("si");
});
it("applies other-tab changes and removal without echo writes", () => {
  render(
    <LocaleProvider initial="si">
      <Selector />
    </LocaleProvider>,
  );
  const write = vi.spyOn(Storage.prototype, "setItem");
  fireEvent(
    window,
    new StorageEvent("storage", {
      key: localePreferenceKey,
      newValue: "en",
      storageArea: localStorage,
    }),
  );
  expect(screen.getByLabelText("one").textContent).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  fireEvent(
    window,
    new StorageEvent("storage", {
      key: localePreferenceKey,
      newValue: null,
      storageArea: localStorage,
    }),
  );
  expect(screen.getByLabelText("one").textContent).toBe("si");
  expect(write).not.toHaveBeenCalled();
});
it("ignores session-storage events and handles a cleared preference", async () => {
  render(
    <LocaleProvider initial="en">
      <Selector />
    </LocaleProvider>,
  );
  fireEvent(
    window,
    new StorageEvent("storage", {
      key: localePreferenceKey,
      newValue: "si",
      storageArea: sessionStorage,
    }),
  );
  expect(screen.getByLabelText("one").textContent).toBe("en");
  await userEvent.click(screen.getByRole("button", { name: "one toggle" }));
  fireEvent(
    window,
    new StorageEvent("storage", {
      key: null,
      newValue: null,
      storageArea: localStorage,
    }),
  );
  expect(screen.getByLabelText("one").textContent).toBe("en");
});
it("continues switching when browser storage reads and writes fail", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Synthetic blocked storage");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Synthetic quota failure");
  });
  render(
    <LocaleProvider initial="si">
      <Selector />
    </LocaleProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "one toggle" }));
  expect(screen.getByLabelText("one").textContent).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});
it("creates independent stores containing only locale and its action", () => {
  const first = createLocaleStore("en"),
    second = createLocaleStore("si");
  first.getState().setLanguage("si");
  second.getState().setLanguage("en");
  expect(first.getState().language).toBe("si");
  expect(second.getState().language).toBe("en");
  first.getState().setLanguage("invalid" as never);
  expect(first.getState().language).toBe("si");
  expect(Object.keys(first.getState()).sort()).toEqual([
    "language",
    "setLanguage",
  ]);
});
it("renders isolated server defaults without reading browser storage", () => {
  const read = vi.spyOn(Storage.prototype, "getItem");
  const english = renderToString(
    <LocaleProvider initial="en">
      <Selector />
    </LocaleProvider>,
  );
  const sinhala = renderToString(
    <LocaleProvider initial="si">
      <Selector />
    </LocaleProvider>,
  );
  expect(english).toContain('aria-label="one">en');
  expect(sinhala).toContain('aria-label="one">si');
  expect(read).not.toHaveBeenCalled();
});
it("removes storage listeners after strict lifecycle replay and unmount", async () => {
  const { unmount } = render(
    <StrictMode>
      <LocaleProvider initial="en">
        <Selector />
      </LocaleProvider>
    </StrictMode>,
  );
  await userEvent.click(screen.getByRole("button", { name: "one toggle" }));
  expect(document.documentElement.lang).toBe("si");
  unmount();
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: localePreferenceKey, newValue: "en" }),
    ),
  );
  expect(document.documentElement.lang).toBe("si");
});

it("persists an explicit choice even when it matches the current default", async () => {
  function Choose() {
    const [, choose] = useLocale();
    return <button onClick={() => choose("en")}>Choose English</button>;
  }
  render(
    <LocaleProvider initial="en">
      <Choose />
    </LocaleProvider>,
  );
  expect(localStorage.getItem(localePreferenceKey)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Choose English" }));
  expect(localStorage.getItem(localePreferenceKey)).toBe("en");
});
