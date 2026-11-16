"use client";
import type { ComponentProps } from "react";
import type { LandRegistration } from "@agri/validation";
import { OnlineCreation, type CreationAdapter } from "./online-creation";
import {
  LandRegistrationForm,
  type WorkingLand,
  type LandRecord,
} from "./land-registration-form";
import { readLandCreationContext } from "../lib/land-creation-context";
import { landRegistrationWords } from "./land-registration-words";
const adapter: CreationAdapter<WorkingLand, LandRecord, LandRegistration> = {
  key: "land-registration",
  selection: (value) => value.geographyId,
  read: async (...args) => ({
    options: (await readLandCreationContext(...args)).geographies,
  }),
  request: (record) => ({ ...record, mutationId: crypto.randomUUID() }),
  submit: (client, owner, request) =>
    client.registerLand(owner.accountId, request, owner.deviceId),
  Form: LandRegistrationForm,
};
type Props = Omit<
  ComponentProps<
    typeof OnlineCreation<WorkingLand, LandRecord, LandRegistration>
  >,
  "adapter" | "copy" | "onSaved"
> & { onSaved: (landId: string) => void };
export function LandRegistrationEditor(props: Props) {
  return (
    <OnlineCreation
      {...props}
      adapter={adapter}
      copy={landRegistrationWords[props.language]}
      onSaved={(request) => props.onSaved(request.landId)}
    />
  );
}
