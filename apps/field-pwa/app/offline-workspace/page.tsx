import { OfflineWorkspacePage } from "../../components/offline-workspace";
export const dynamic = "force-static";
/** Public application shell. Never fetch or render private server data in this route. */
export default function OfflinePage() {
  return <OfflineWorkspacePage />;
}
