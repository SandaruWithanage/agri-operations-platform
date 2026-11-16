import { PilotClient, PilotRequestError } from "@agri/sync-client";
export type RegistrationOwner = { accountId: string; deviceId: string };
/** Create options are references, never permission to read existing farmers. */
export async function readRegistrationContext(
  client: PilotClient,
  owner: RegistrationOwner,
  selectedGeography?: string,
  signal?: AbortSignal,
) {
  const identity = await client.sessionIdentity(signal);
  if (
    identity.accountId !== owner.accountId ||
    identity.deviceId !== owner.deviceId
  )
    throw new PilotRequestError(401);
  const context = await client.context(signal);
  signal?.throwIfAborted();
  if (
    context.accountId !== owner.accountId ||
    context.deviceId !== owner.deviceId
  )
    throw new PilotRequestError(401);
  if (
    selectedGeography &&
    !context.geographies.some((value) => value.id === selectedGeography)
  )
    throw new PilotRequestError(403);
  return { geographies: context.geographies };
}
