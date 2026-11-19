import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminShell } from "../packages/ui/src/admin-shell";
import { PermissionProvider } from "../packages/ui/src/permission-action";

afterEach(() => cleanup());

function shell(select = vi.fn()) {
  return render(
    <AdminShell
      brandName="Agricultural Operations"
      navLabel="Records"
      skipLabel="Skip to content"
      plannedHeading="Planned modules"
      plannedTag="Planned"
      planned={["Reports", "Resources"]}
      toolbar={<span>toolbar</span>}
      items={[
        {
          id: "farmers",
          group: "Records",
          permission: "farmer.read",
          icon: "farmers",
          label: "Farmers",
          current: true,
          onSelect: () => select("farmers"),
        },
        {
          id: "land",
          group: "Records",
          permission: "land.read",
          icon: "land",
          label: "Land",
          current: false,
          onSelect: () => select("land"),
        },
      ]}
    >
      <h1>Page title</h1>
    </AdminShell>,
  );
}

it("marks the current page, selects pages and has one main landmark and a skip link", async () => {
  const select = vi.fn();
  shell(select);
  const nav = screen.getByRole("navigation", { name: "Records" });
  const farmers = within(nav).getByRole("button", { name: "Farmers" });
  const land = within(nav).getByRole("button", { name: "Land" });
  expect(farmers.getAttribute("aria-current")).toBe("page");
  expect(land.getAttribute("aria-current")).toBeNull();
  await userEvent.click(land);
  expect(select).toHaveBeenCalledWith("land");
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(
    screen.getByRole("link", { name: "Skip to content" }).getAttribute("href"),
  ).toBe("#agri-shell-main");
  expect(document.querySelector("svg[aria-hidden='true']")).not.toBeNull();
});

it("lists unbuilt modules as plain text, never as buttons or links", () => {
  shell();
  expect(screen.getByText("Reports")).toBeTruthy();
  expect(screen.getAllByText("Planned")).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: /Reports|Resources/ }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: /Reports|Resources/ })).toBeNull();
});

it("lists items under their section headings", () => {
  shell();
  const nav = screen.getByRole("navigation", { name: "Records" });
  expect(within(nav).getByText("Records")).toBeTruthy();
  expect(within(nav).getAllByRole("list")).toHaveLength(1);
});

it("lists every page while the account's permissions are unknown", () => {
  shell();
  expect(screen.getByRole("button", { name: "Farmers" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Land" })).toBeTruthy();
});

it("leaves out pages whose read permission the account lacks", () => {
  render(
    <PermissionProvider capabilities={new Set(["farmer.read"])}>
      <AdminShell
        brandName="Agricultural Operations"
        navLabel="Records"
        skipLabel="Skip to content"
        plannedHeading="Planned modules"
        plannedTag="Planned"
        planned={[]}
        toolbar={<span>toolbar</span>}
        items={[
          {
            id: "farmers",
            group: "Records",
            permission: "farmer.read",
            icon: "farmers",
            label: "Farmers",
            current: true,
            onSelect: () => {},
          },
          {
            id: "land",
            group: "Records",
            permission: "land.read",
            icon: "land",
            label: "Land",
            current: false,
            onSelect: () => {},
          },
        ]}
      >
        <h1>Page title</h1>
      </AdminShell>
    </PermissionProvider>,
  );
  expect(screen.getByRole("button", { name: "Farmers" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Land" })).toBeNull();
});
