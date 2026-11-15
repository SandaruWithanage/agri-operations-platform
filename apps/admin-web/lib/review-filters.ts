import {
  farmerListFiltersSchema,
  type FarmerListFilters,
} from "@agri/validation";
/** Only enum/boolean view selections enter URLs; never names, records or actor scopes. */
export function readReviewFilters(url: URL): FarmerListFilters | null {
  if (
    ["farmerStatus", "reviewable"].some(
      (key) => url.searchParams.getAll(key).length > 1,
    )
  )
    return null;
  const status = url.searchParams.get("farmerStatus"),
    reviewable = url.searchParams.get("reviewable");
  const parsed = farmerListFiltersSchema.safeParse({
    ...(status !== null ? { status } : {}),
    ...(reviewable !== null ? { reviewable } : {}),
  });
  return parsed.success
    ? {
        ...parsed.data,
        ...(parsed.data.reviewable && !parsed.data.status
          ? { status: "pending-review" as const }
          : {}),
      }
    : null;
}
export function reviewFilterUrl(url: URL, filters: FarmerListFilters): string {
  const parsed = farmerListFiltersSchema.parse(filters);
  const value = {
    ...parsed,
    ...(parsed.reviewable && !parsed.status
      ? { status: "pending-review" as const }
      : {}),
  };
  const result = new URL(url);
  result.searchParams.delete("farmerStatus");
  result.searchParams.delete("reviewable");
  if (value.status) result.searchParams.set("farmerStatus", value.status);
  if (value.reviewable) result.searchParams.set("reviewable", value.reviewable);
  return `${result.pathname}${result.search}${result.hash}`;
}
