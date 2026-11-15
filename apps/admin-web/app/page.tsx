import { FarmerRegistry } from "../components/farmer-registry";
/** Public client shell. Authenticated farmer data is requested through the no-store BFF. */
export default function Home() {
  return <FarmerRegistry />;
}
