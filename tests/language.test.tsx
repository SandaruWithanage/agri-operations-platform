import { afterEach, expect, test } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "../apps/field-pwa/app/page";
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
test("officer can switch between Sinhala and English with matching document language", async () => {
  const user = userEvent.setup();
  render(<Home />);
  expect(document.documentElement.lang).toBe("si");
  await user.click(screen.getByRole("button", { name: "English" }));
  expect(
    screen.getByRole("heading", { name: "Field officer workspace" }),
  ).toBeTruthy();
  expect(document.documentElement.lang).toBe("en");
  expect(window.localStorage.getItem("agri-language")).toBe("en");
  cleanup();
  render(<Home />);
  expect(document.documentElement.lang).toBe("en");
  await user.click(screen.getByRole("button", { name: "සිංහල" }));
  expect(document.documentElement.lang).toBe("si");
  expect(
    screen.getByRole("button", { name: "සිංහල" }).getAttribute("aria-pressed"),
  ).toBe("true");
});

test("field officer sees device connection changes", () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
  try {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    render(<Home />);
    expect(screen.getByText("උපාංගය ජාලයකට සම්බන්ධ වී ඇත.")).toBeTruthy();
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("උපාංගය නොබැඳිව ඇත.")).toBeTruthy();
  } finally {
    if (original) Object.defineProperty(window.navigator, "onLine", original);
    else Reflect.deleteProperty(window.navigator, "onLine");
  }
});
