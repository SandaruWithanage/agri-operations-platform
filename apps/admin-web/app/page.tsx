import { applicationName } from "@agri/ui";
export default function Home() {
  return (
    <main>
      <p className="kicker">{applicationName} • Admin</p>
      <h1>Engineering foundation</h1>
      <div className="card">
        <h2>Admin application scaffold</h2>
        <p>
          Next milestone: authentication, scoped farmer registry and
          PostgreSQL-enforced ABAC.
        </p>
        <div className="status">
          No real farmer or project data is connected.
        </div>
      </div>
    </main>
  );
}
