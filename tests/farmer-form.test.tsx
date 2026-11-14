import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerRegistrationForm } from "../apps/field-pwa/components/farmer-registration-form";
const geography = {
  id: "4e743f19-e3f7-4ed0-bdcc-29fe8e71ff0d",
  label: "Synthetic village",
};
afterEach(cleanup);
it("requires a name, configured geography and privacy notice", async () => {
  const user = userEvent.setup();
  const save = vi.fn();
  render(
    <FarmerRegistrationForm
      language="en"
      geographies={[geography]}
      onSave={save}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Save registration" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Full name"), "Synthetic farmer");
  await user.selectOptions(
    screen.getByLabelText("GN division or village"),
    geography.id,
  );
  await user.click(
    screen.getByLabelText("I provided the required privacy notice"),
  );
  await user.click(screen.getByRole("button", { name: "Save registration" }));
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({
    fullName: "Synthetic farmer",
    geographyId: geography.id,
    privacyNoticeProvided: true,
  });
});
it("retains values and farmer UUID after failed save, and provides Sinhala labels", async () => {
  const user = userEvent.setup();
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  render(
    <FarmerRegistrationForm
      language="si"
      geographies={[geography]}
      onSave={save}
    />,
  );
  await user.type(screen.getByLabelText("සම්පූර්ණ නම"), "ගොවි උදාහරණය");
  await user.selectOptions(
    screen.getByLabelText("ග්‍රාම නිලධාරී වසම හෝ ගම"),
    geography.id,
  );
  await user.click(screen.getByLabelText("අවශ්‍ය පෞද්ගලිකත්ව දැනුම්දීම ලබා දුන්නා"));
  await user.click(screen.getByRole("button", { name: "ලියාපදිංචිය සුරකින්න" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "ලියාපදිංචිය සුරකින්න" }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0][0].farmerId).toBe(save.mock.calls[1][0].farmerId);
});
it("disables submission without authorized geographic options", () => {
  render(
    <FarmerRegistrationForm language="en" geographies={[]} onSave={vi.fn()} />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Save registration",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
