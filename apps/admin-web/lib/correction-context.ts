import { PilotClient, PilotRequestError } from "@agri/sync-client";
import {
  farmerDetailQuerySchema,
  type FarmerSummary,
  type FarmerCorrectionGeographies,
} from "@agri/validation";
export type CorrectionSource = Pick<
  FarmerSummary,
  "id" | "fullName" | "geographyId" | "version"
>;
export type CorrectionOwner = { accountId: string; deviceId: string };
/** PostgreSQL orders UUID bytes, matching the unsigned 128-bit predecessor here. */
export function beforeGeography(id: string): string | undefined {
  farmerDetailQuerySchema.parse({ id });
  const value = BigInt(`0x${id.replaceAll("-", "")}`);
  if (value === BigInt(0)) return undefined;
  const hex = (value - BigInt(1)).toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function readCorrectionContext(
  client: PilotClient,
  owner: CorrectionOwner,
  source: CorrectionSource,
  after: string | undefined,
  signal: AbortSignal,
) {
  const identity = await client.sessionIdentity(signal);
  signal.throwIfAborted();
  if (
    identity.accountId !== owner.accountId ||
    identity.deviceId !== owner.deviceId
  )
    throw new PilotRequestError(401);
  const detail = await client.farmer(source.id, signal);
  signal.throwIfAborted();
  if (detail.accountId !== owner.accountId || detail.farmer.id !== source.id)
    throw new PilotRequestError(401);
  if (detail.access?.correct !== true) throw new PilotRequestError(403);
  const page = await client.farmerCorrectionGeographies(
    source.id,
    after,
    signal,
  );
  signal.throwIfAborted();
  const check = (value: FarmerCorrectionGeographies) => {
    if (value.accountId !== owner.accountId || value.farmerId !== source.id)
      throw new PilotRequestError(401);
    if (
      value.farmerVersion !== detail.farmer.version ||
      value.sourceGeographyId !== detail.farmer.geographyId
    )
      throw new PilotRequestError(503);
  };
  check(page);
  // A moved record does not by itself permit disclosing the old-location draft.
  // Request a bounded eligible page immediately before that UUID to prove access.
  if (detail.farmer.geographyId !== source.geographyId) {
    const originalCursor = beforeGeography(source.geographyId);
    const proof =
      after === originalCursor
        ? page
        : await client.farmerCorrectionGeographies(
            source.id,
            originalCursor,
            signal,
          );
    signal.throwIfAborted();
    check(proof);
    if (proof.geographies[0]?.id !== source.geographyId)
      throw new PilotRequestError(403);
  }
  return { current: detail.farmer, choices: page };
}
