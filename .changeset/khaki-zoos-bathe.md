---
"graphile-build-pg": patch
"postgraphile": patch
"@dataplan/pg": patch
---

🚨 PostgreSQL adaptor is no longer loaded via string value; instead you must
pass the adaptor instance directly. If you have
`adaptor: "@dataplan/pg/adaptors/pg"` then replace it with
`adaptor: await import("@dataplan/pg/adaptors/pg")`. This is to improve
bundle-ability by reducing the number of dynamic imports. Also:
`PgAdaptorOptions` has been renamed to `PgAdaptorSettings`, so please do a
global find and replace for that.
