"use client";
import { FarmerRegistrationForm } from "@agri/ui/farmer-registration";
import type { FarmerRegistration, WorkingRegistration } from "@agri/validation";
import { readRegistrationContext } from "../lib/registration-context";
import {
  OnlineCreation,
  creationIdleMs,
  type CreationAdapter,
  type CreationDraft,
} from "./online-creation";
import { registrationWords } from "./registration-words";
import type { ComponentProps } from "react";
export const registrationIdleMs = creationIdleMs;
export type RegistrationDraft = CreationDraft;
type Request = { mutationId: string; farmer: FarmerRegistration };
const adapter: CreationAdapter<
  WorkingRegistration,
  FarmerRegistration,
  Request
> = {
  key: "farmer-registration",
  selection: (value) => value.geographyId,
  read: async (client, owner, selected, signal) => ({
    options: (await readRegistrationContext(client, owner, selected, signal))
      .geographies,
  }),
  request: (farmer) => ({ mutationId: crypto.randomUUID(), farmer }),
  submit: (client, owner, request) =>
    client.register(owner.accountId, request, owner.deviceId),
  Form: ({ options, ...props }) => (
    <FarmerRegistrationForm {...props} geographies={options} />
  ),
};
type Props = Omit<
  ComponentProps<
    typeof OnlineCreation<WorkingRegistration, FarmerRegistration, Request>
  >,
  "adapter" | "copy" | "onSaved"
> & { onSaved: (farmerId: string) => void };
export function FarmerRegistrationEditor(props: Props) {
  return (
    <OnlineCreation
      {...props}
      adapter={adapter}
      copy={registrationWords[props.language]}
      onSaved={(request) => props.onSaved(request.farmer.farmerId)}
    />
  );
}
