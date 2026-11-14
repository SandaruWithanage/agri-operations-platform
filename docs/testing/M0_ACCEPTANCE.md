# M0 acceptance (do not mark complete until tested)

- `pnpm install` succeeds with Node 22.
- `pnpm check:structure` passes.
- `pnpm typecheck` and `pnpm build` pass.
- `pnpm db:up` starts PostgreSQL/PostGIS; check readiness and `SELECT PostGIS_Version();`.
- `pnpm dev` serves admin on 3000, field on 3001, API health on 4000.
- CI runs on a pull request to main.
- Runtime database credentials separated from bootstrap credentials before adding DB-backed APIs.
- No farmer data, authentication or offline persistence is implied by this scaffold.
