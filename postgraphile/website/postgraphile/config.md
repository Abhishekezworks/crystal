# Configuration

PostGraphile is configured through a `graphile-config` "preset." A preset is a
simple JS object that contains a combination of other presets, plugins, and
options for the various scopes.

Your preset will almost certainly need to extend an existing preset or presets,
and which preset(s) to extend depends on what you're looking for from
PostGraphile.

(TODO: expand here with different use cases and presets that support them.)

PostGraphile presets are named after crystals; the first preset available is
`postgraphile/presets/amber`, so you'll definitely want that. If you're coming
from PostGraphile V4 you may also want to make your own preset with the
`makeV4Preset()` factory - see the
[V4 migration docs](./migrating-from-v4/index.md) for more information.

## General structure

A preset is a plain JavaScript object, and every key in the preset is optional.
`{}` is a valid (but not very useful!) preset.

The value for the `extends` key, if specified, must be an array of other presets
your preset wishes to extend.

The value for the `plugins` key, if specified, must be an array of
`graphile-config` plugins that your preset wishes to make use of. Plugins must
always have unique names, and will be automatically de-duplicated by the system
if the same plugin is referenced in multiple presets.

The preset also accepts keys for each supported scope. `graphile-config` has no
native scopes, but different Graphile projects can register their own scopes,
for example `graphile-build` registers the `inflection`, `gather` and `schema`
scopes, `graphile-build-pg` registers the `pgConfigs` scope, and PostGraphile
registers the `server` scope.

We highly recommend using TypeScript for dealing with your preset so that you
get auto-completion for the options available in each scope. It may be necessary
to add `import "postgraphile"` at the top of the configuration file so that
TypeScript imports all the available scopes.

Note that the schema build process in PostGraphile is:

- Synchronously build the inflectors via the "inflection" phase - inflectors are
  used throughout all other phases
- Asynchronously build the data sources by performing database introspection in
  the "gather" phase
- Synchronously build the GraphQL schema during the "schema" phase

```ts
// Only needed for TypeScript types support
import "postgraphile";

import amber from "postgraphile/presets/amber";
import { StreamDeferPlugin } from "graphile-build";
import { makePgConfigs } from "postgraphile";

/** @type {GraphileConfig.Preset} */
const preset = {
  extends: [
    amber,
    /* Add more presets here */
  ],

  plugins: [
    /* Add plugins here, e.g.: */
    StreamDeferPlugin,
  ],

  inflection: {
    /* options for the inflection system */
  },
  pgConfigs: [
    /* list of PG database configurations, e.g.: */
    ...makePgConfigs(
      // Database connection string:
      process.env.DATABASE_URL,
      // List of schemas to expose:
      ["app_public"],
    ),
  ],
  gather: {
    /* options for the gather phase */
  },
  schema: {
    /* options for the schema build phase */
  },
  grafast: {
    /* options for Grafast, including setting GraphQL context*/
  },
  server: {
    /* options for the server */
  },
};

export default preset;
```

## `inflection` options

_(TypeScript type: `GraphileBuild.GraphileBuildInflectionOptions`)_

_None at this time._

## `pgConfigs`

_(TypeScript type: `ReadonlyArray<GraphileConfig.PgDatabaseConfiguration>`)_

Details the PostgreSQL database(s) for PostGraphile to connect to; this is a
separate option because it's used in both the `gather` phase (for introspection)
and at runtime.

Generally it's best to construct this by using the `makePgConfigs` helper (see
below), but if you want to know the nitty-gritty: each entry in the list is an
object with the following keys (only `name` and `adaptor` are required):

- `name: string` - an arbitrary unique name for this config; please keep it
  alphanumeric!
- `adaptor: string` - the name of the module to use as the postgres adaptor;
  e.g. `@dataplan/pg/adaptors/node-postgres` for the `pg` module
- `adaptorSettings` - options to pass to the adaptor, these are different for
  each adaptor
- `schemas: string[]` - an array of PostgreSQL schema names to use
- `listen: (topic: string) => AsyncIterable<string>` - a callback function to
  use to listen to a particular topic
- `pgSettings: (ctx: GraphileConfig.GraphQLRequestContext) => Record<string, string> | null` -
  a callback function that will be called by the server to determine the
  pgSettings to use for a particular request
- `pgSettingsForIntrospection: Record<string, string> | null` - the pgSettings
  to use when introspecting the database (for example if you want to change
  roles)
- `withPgClientKey: string` - the key on the `context` object to store the
  `withPgClient` method the schema uses for communicating with the database
- `pgSettingsKey: string` - the key on the `context` object to store the
  `pgSettings` configuration to use when communicating with the database

```js title="Example manual configuration"
import * as pg from "pg";

const pgConfigs = [
  {
    name: "main",
    schemas: ["app_public"],
    pgSettingsKey: "pgSettings",
    withPgClientKey: "withPgClient",
    adaptor: "@dataplan/pg/adaptors/node-postgres",
    adaptorSettings: {
      pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
    },
  },
];
```

### `makePgConfigs`

This simple function will take a PostgreSQL connection string and a list of
schemas and will return an array containing a configuration object suitable for
inclusion in `pgConfigs`.

:::info

Currently this uses the `pg` module, but we may change
that default over time.

:::

```js title="Example configuration via makePgConfigs"
const pgConfigs = makePgConfigs(process.env.DATABASE_URL, ["app_public"]);
```

## `gather` options

_(TypeScript type: `GraphileBuild.GraphileBuildGatherOptions`)_

- `pgStrictFunctions: boolean` - if true, we'll treat all PostgreSQL function
  arguments that don't have defaults as being required (non-nullable)
- `pgJwtType: [string, string]` - the schema name and type name for the type in
  the database to convert into a JWT (equivalent to giving this type the
  behavior `"-table +jwt"`)
- `installWatchFixtures: boolean` - if not false and schema is in watch mode
  then we will attempt to install the "event triggers" into the database so that
  PostGraphile can be notified when your database changes

Deprecated options:

- `pgV4UseTableNameForNodeIdentifier: boolean` - if true, uses the table name
  instead of the type name in the Node identifier (highly discouraged because it
  significantly increases the risk of NodeID conflicts)

## `schema` options

_(TypeScript type: `GraphileBuild.SchemaOptions`)_

:::tip

Plugins may add additional options, please refer to your plugins' documentation
to determine the options that they offer.

:::

- `jsonScalarAsString: boolean` - if true, JSON values will be stringified
  rather than returned as "dynamic" objects.
- `nodeIdFieldName: string` - the name for the `id: ID` field; typically this is
  `id` but you may wish to set it to `_id` or `nodeId` to avoid conflicts with
  your `id` database columns
- `dontSwallowErrors: boolean` - if true, errors during the schema build process
  will throw rather than the system trying to recover from them. Recommended,
  but not enabled by default as it can be a barrier to entry to new users.
- `simpleCollections: 'only' | 'both' | 'omit'` - defaults to omit; changes the
  default behavior for collection generation
  - `only` - does not build Relay connections, instead just simple GraphQL lists
  - `omit` - does not build simple lists, instead builds Relay connections
    (recommended)
  - `both` - supplies both lists and connections, making your schema somewhat
    larger (not recommended)
- `pgJwtSecret`
- `pgJwtSignOptions`
- `pgUseCustomNetworkScalars: boolean` - if not false, adds the `CidrAddress`,
  `MacAddress` and similar types for PostgreSQL network scalars.
- `orderByNullsLast: boolean | undefined` - if true, orders such that nulls are
  always last; if false, orders such that nulls are always first; otherwise uses
  the default ordering
- `pgForbidSetofFunctionsToReturnNull: boolean` - if true, setof functions
  cannot return null, so our list and connection types can be non-nullable in
  more places.
- `subscriptions`

## `grafast` options

_(TypeScript type: `import type { GrafastOptions } from "grafast"`)_

- `explain` - a list of 'explain' types that should be exposed to clients via
  `extensions.explain` (`mermaid-js` for the operation plan, `sql` for the
  SQL), or `true` to expose everything.
- `context` - an object (or function that returns an object, or promise to an
  object) to be merged into the GraphQL context, accessible from plan
  resolvers. If a function, it will receive two parameters, first is the
  request context (which may contain details such as the incoming HTTP request,
  depends on what server/etc you are using) and the second is the current
  context object that your results will be merged into (overwriting
  pre-existing keys).

### Making HTTP data available to plan resolvers

Using the `grafast.context` callback we can extract data from the incoming HTTP
request and make it accessible from within the Gra*fast* schema via the GraphQL context.

:::warning

Be careful to not clash with system context keys such as `withPgClient`,
`pgSettings` and `jwtClaims` (you can see the existing context keys by
inspecting the second argument to the `context` function).

For the absolute best future compatibility, we recommend that you prefix your
context keys with your initials, company name, or similar.

:::

Example:

```js title="graphile.config.js"
export default {
  grafast: {
    async context(requestContext) {
      const req = requestContext.httpRequest;
      // You can perform asynchronous actions here if you need to; for example
      // looking up the current user in the database.

      // Return here things that your resolvers need
      return {
        // Return the current user from Passport.js or similar
        user: req.user,

        // Add a helper to get a header
        getHeader(name) {
          return req.get(name);
        },

        // Give access to the database-owner PostgreSQL pool, for example to
        // perform privileged actions
        rootPgPool,
      };
    },
  },
};
```

:::tip

It's _not_ a good idea to give direct access to the `req` or `res` objects
via `context` as it binds the context too tightly to the HTTP request
lifecycle — this will cause you issues if you try and use the GraphQL schema in
other contexts (e.g. directly or over alternative transports such as websockets
for realtime). Instead, add helpers to get/set the data you need.

:::

### Exposing HTTP request data to PostgreSQL

Using the `pgSettings` functionality mentioned in the `pgConfigs` section above
you can extend the data made available within PostgreSQL through
`current_setting(...)`. To do so, include a `pgSettings` entry in the GraphQL
context mentioned in the "Grafast options" section above, the value for which
should be a POJO (plain old JavaScript object) with string keys and values.

:::warning

You can use `pgSettings` to define variables that your Postgres
functions/policies depend on, or to tweak internal Postgres settings.

When adding variables for your own usage, the keys **must** contain either one
or two period (`.`) characters, and the prefix (the bit before the first
period) must not be used by any Postgres extension. We recommend using a prefix
such as `jwt.` or `myapp.`. Examples: `jwt.claims.userid`, `myapp.is_admin`

Variables without periods will be interpreted as internal Postgres settings,
such as `role`, and will be applied by Postgres.

:::

Remember: the `context` entry can be a callback (even an asynchronous callback
if you need) which can extract details from the HTTP request. Here's an example
that extracts the user's ID from a JWT and adds information from a specific
HTTP header:

```ts title="graphile.config.js"
import jwt from "jsonwebtoken";

// TODO: test this actually works

export default {
  // ...

  grafast: {
    async context(requestCtx, graphqlContext) {
      // Extract details from the requestCtx
      const req = requestCtx.httpRequest;
      const auth = req.getHeader("authorization");

      const context = {};

      // Process the authorization header
      if (typeof auth === "string") {
        const parts = auth.split(" ");
        if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
          const token = parts[1];
          const claims = jwt.verify(token, process.env.JWT_SECRET);
          const userId = claims.uid;
          context.pgSettings = {
            "myapp.user_id": userId,
            "myapp.headers.x_something": req.getHeader("x-something"),
          };
        }
      }

      return context;
    },
  },
};
```

:::tip

GraphQL itself is transport agnostic, as is `grafast`, so depending on how you
choose to use your PostGraphile schema you may or may not have access to an
`httpRequest` or similar. Your `context` callback should be written to support
all the different ways that your schema may be used: directly, over HTTP, using
websockets, etc.

:::

With the above example, you could write an SQL function `get_x_something()` to
get the `myapp.headers.x_something` setting:

```sql
create function get_x_something() returns text as $$
  select nullif(current_setting('myapp.headers.x_something', true), '')::text;
$$ language sql stable;
```

By default, everything in `pgSettings` is applied to the current transaction
with `set_config($key, $value, true)`; note that `set_config` only supports
string values so it is best to only feed `pgSettings` string values (we'll
convert other values using the `String` constructor function, which may not
have the effect you intend). All settings are automatically reset when the
transaction completes.

Here's an example of switching the PostgreSQL client into the 'visitor' role,
and applying the application setting `jwt.claims.user_id` using the `req.user`
object from an Express server:

```js title="graphile.config.js"
export default {
  grafast: {
    context: ({ httpRequest: req }) => ({
      pgSettings: {
        role: "visitor",
        "jwt.claims.user_id": `${req.user.id}`,
        //...
      },
    }),
  },
};
```

<!-- TODO: verify the above works. -->

## `server` options

_(TypeScript type: `import { ServerOptions } from "grafserv"`)_

- `port: number` - Port number to listen on (default: 5678)
- `host: string` - Host to listen on (default: '127.0.0.1'; consider setting to
  '0.0.0.0' in Docker and similar environments)
- `graphqlPath: string` - The path at which GraphQL will be available; usually
  `/graphql`
- `eventStreamRoute: string` - The path at which the GraphQL event stream would
  be made available; usually `/graphql/stream`
- `graphqlOverGET: boolean` - If true, we'll support GraphQL queries over the
  GET method
- `graphiql: boolean`
- `graphiqlOnGraphQLGET: boolean` - If true, then we will render GraphiQL on GET
  requests to the `/graphql` endpoint
- `graphiqlPath: string` - The path at which GraphiQL will be available; usually
  `/`
- `watch: boolean` - Set true to enable watch mode
- `maxRequestLength: number` - The length, in bytes, for the largest request
  body that the server will accept
