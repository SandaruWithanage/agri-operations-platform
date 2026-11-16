import { PilotClient, PilotRequestError } from "@agri/sync-client";
import type { CreationOwner } from "../components/online-creation";
export async function readLandCreationContext(
  client: PilotClient,
  owner: CreationOwner,
  selected: string | undefined,
  signal: AbortSignal,
) {
  const identity = await client.sessionIdentity(signal);
  if (
    identity.accountId !== owner.accountId ||
    identity.deviceId !== owner.deviceId
  )
    throw new PilotRequestError(401);
  const result = await client.landGeographies(signal);
  const after = await client.sessionIdentity(signal);
  signal.throwIfAborted();
  if (after.accountId !== owner.accountId || after.deviceId !== owner.deviceId)
    throw new PilotRequestError(401);
  if (result.accountId !== owner.accountId) throw new PilotRequestError(401);
  if (selected && !result.geographies.some((value) => value.id === selected))
    throw new PilotRequestError(403);
  return {
    geographies: result.geographies.map((value) => ({
      id: value.id,
      label: value.name,
    })),
  };
}
