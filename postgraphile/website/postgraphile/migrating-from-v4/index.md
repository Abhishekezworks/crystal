# Migrating from V4

One of the main aims for PostGraphile V5 was to replace the "lookahead engine"
with something better: easier to reason about, easier to maintain and extend,
easier for users to interact with, and more capable of handling GraphQL's
present and future feature set (V4's lookahead doesn't even support interfaces
and unions, let alone `@stream`, `@defer`, client controlled nullability, and
everything else that's coming down the GraphQL pipeline).

We didn't set out to do so, but ultimately this ended up with us writing our own
GraphQL runtime, called [Gra*fast*][grafast]. This runtime is built around a
carefully engineered planning phase followed by an highly optimized execution
phase. This much more powerful system allowed us to generate much more
efficient SQL queries, and to execute requests much faster than in V4, which
was already pretty fast!

However, Gra*fast* was completely different (not similar in the slightest) to V4's
lookahead engine, and that lookahead engine was the beating heart of V4.
Replacing it required us to rebuild the entire stack from scratch on top of
these new foundations.

Since we had to rebuild everything anyway, we decided to fix a large number of
issues that had been bugging us for a while... The plugin system has been
consolidated and transformed, the configuration system has been consolidated
and transformed, some of the smart tags (`@omit`, `@simpleCollections`, etc)
have been replaced with behaviors (`@behavior`), all the plugins have been
rewritten or replaced, the defaults have evolved, ... but I'm getting ahead of
myself.

If you're reading this, you probably want to know how to take your PostGraphile
V4 project and run it in PostGraphile V5 instead with the minimal of fuss. One
of the reasons that V5 took so long, other than that we invented an entirely
new set of technologies and then rebuilt the entire Graphile GraphQL ecosystem
from scratch on top of them, was the amount of effort that we put into trying
to minimize the amount of effort it will take _you_ to move to V5.

Note that there are subpages dedicated to particular plugin/plugin generators
that need their own V5 migration strategy.

Let's get started.

## Basic configuration

PostGraphile V5 requires a "preset" to be specified; this allows users to start
with the best settings for their intended use case without having to read pages
of documentation first. It also allows us to evolve the defaults over time
without breaking existing users schemas - ultimately meaning we no longer need a
"recommended options" section in the docs.

To achieve this, we've introduced a new module: `graphile-config`. This module
takes care of the common concerns relating to configuration, in particular:
presets, plugins and options. You store your config into a `graphile.config.js`
(or `.ts`, `.mjs`, `.mts`) file and this can then be used from the command
line, library mode, or even schema-only mode - they all share the same
configuration.

To make the transition to this new system easier, we've built a `makeV4Preset`
preset factory for you that converts a number of the options that you are
familiar with from V4 into their V5 equivalents. To use it, feed your options
into its first argument, and combine it with `postgraphile/presets/amber` (our
initial preset) to get a completed config:

```ts title="graphile.config.js"
import "graphile-config";

import PresetAmber from "postgraphile/presets/amber";
import { makeV4Preset } from "postgraphile/presets/v4";
// Use the 'pg' module to connect to the database
import { makePgConfig } from "@dataplan/pg/adaptor/pg";

/** @type {GraphileConfig.Preset} */
const preset = {
  extends: [
    // The initial PostGraphile V5 preset
    PresetAmber.default ?? PresetAmber,

    // Change the options and add/remove plugins based on your V4 configuration:
    makeV4Preset({
      /* PUT YOUR V4 OPTIONS HERE, e.g.: */
      simpleCollections: "both",
      jwtPgTypeIdentifier: '"b"."jwt_token"',
      appendPlugins: [
        /*...*/
      ],
    }),

    // Note some plugins are now "presets", e.g.
    // `@graphile/simplify-inflection`, those should be listed here instead of `appendPlugins`
  ],

  plugins: [
    /*
     * If you were using `pluginHook` before, the relevant plugins will need
     * listing here instead. You can also move the `appendPlugins` list here
     * for consistency if you like.
     */
  ],

  /*
   * PostgreSQL database configuration.
   *
   * If you're using the CLI you can skip this and use the `-c` and `-s`
   * options instead, but we advise configuring it here so all the modes of
   * running PostGraphile can share it.
   */
  pgConfigs: [
    makePgConfig({
      // Database connection string:
      connectionString: process.env.DATABASE_URL,
      // List of schemas to expose:
      schemas: ["app_public"],
      // Superuser connection string, only needed if you're using watch mode:
      // superuserConnectionString: process.env.SUPERUSER_DATABASE_URL,
    }),
  ],
};

export default preset;
```

Note that the `appendPlugins`/`prependPlugins`/`skipPlugins` options require
V5-compatible plugins, and `pluginHook` is no longer supported - please use the
`plugins` configuration key instead.

Note also that `PgNodeAliasPostGraphile` (plugin) no longer exists, so instead
of skipping it with `skipPlugins` you should add the following to your preset:

```js
const preset = {
  // ...
  schema: {
    // ...
    pgV4UseTableNameForNodeIdentifier: false,
  },
};
```

:::info

Not all of the community's V4 plugins have been ported to V5 at time of
writing, but with your help hopefully we can fix that!

:::

### additionalGraphQLContextFromRequest

You can provide this to `makeV4Preset({ additionalGraphQLContextFromRequest })`, so no specific action is required.

:::info

If you want to do this the V5 way then the replacement is the
'grafast.context' option; please see [configuration -
context](../config.md#grafast-options).

```ts
const preset = {
  //...
  grafast: {
    context(ctx) {
      // Other servers/transports add different details to `ctx`.
      const { req, res } = ctx.node ?? {};
      return additionalGraphQLContextFromRequest(req, res);
    },
  },
};
```

:::

### pgSettings

You can provide this to `makeV4Preset({ pgSettings })`, so no specific action is required.

:::info

If you want to do this the V5 way then the replacement is to
return a `pgSettings` key from the GraphQL context returned from your
'grafast.context' configuration, for more details see [configuration -
context](../config.md#grafast-options).

```ts
const preset = {
  //...
  grafast: {
    context(ctx) {
      // Other servers/transports add different details to `ctx`.
      const { req } = ctx.node ?? {};
      return {
        pgSettings: pgSettings(req);
      };
    },
  },
};
```

:::

## Breaking GraphQL schema changes

We've done our best to maintain as much compatibility with a V4 GraphQL schema
as possible when you use `makeV4Preset()`, but some breaking changes persist
(we'd argue they're for the better!). Of course if any of these are critical
issues to you they can all be solved by writing a plugin to shape the GraphQL
API how you need, but we suggest that if possible you accept these new changes.

- The long deprecated "legacy relations" are no longer generated.
- Node IDs for bigint columns have changed (specifically numbers under
  `MAX_SAFE_INT` now have quote marks inside the encoding too)
- In alignment with the
  [Cursor connections specification](https://relay.dev/graphql/connections.htm),
  connection edges are nullable and cursors are not. It seems we implemented
  this the wrong way around in V4.
- For `fooEdge` fields on mutation payloads, the `orderBy` argument is now
  non-nullable. It still has a default, so this will only affect you if you were
  explicitly passing `null` (why would you do that?!).
- The `fooEdge` fields on mutation payloads now only exist if the table has a
  primary key.
- If you disable `NodePlugin` then the `deletedFooId` field on mutation
  payloads now will not be added to the schema (it never should have been).

Many of the above issues will not cause any problems for the vast majority of
your operations - an engineer from our sponsor Netflix reported that all 4,000
unique queries that their very large and complex V4 internal schema received in
Feb 2023 validated successfully against their V5 schema - zero breakage!
Despite the query compatibility, you may still need to migrate some types on
the client side.

Other changes:

- The values generated for `cursor` differ. This is not deemed to be a breaking
  change, as these may change from one release to the next (even patch versions).
- In some circumstances the location where a `null` is returned or an error is
  thrown may differ slightly between V4 and V5; this will still respect the
  GraphQL schema though, of course.

## Smart tag changes

Despite the following changes, if you're using `makeV4Preset` then you should
not need to take any action - the established V4 behavior should be
automatically emulated.

- The `@uniqueKey` smart tag is no more; the V4 preset converts it to
  `@unique ...|@behavior -single -update -delete` for you.
- The `@omit` smart tag is no more; the V4 preset converts it to the
  relevant [behavior](../behavior.md) for you.
- The `@simpleCollections` smart tag is no more; the V4 preset converts it to the
  relevant [behavior](../behavior.md) for you.
- The `@foreignKey` smart tag must reference a unique constraint or primary
  key; the V4 preset automatically sets
  `pgFakeConstraintsAutofixForeignKeyUniqueness: true` which creates this
  `unique` for you (via a smart tag) and gives it the relevant behaviors so
  that it doesn't turn into more fields/arguments/etc.

The behavior system gives much finer grained control over which things
should/should not be exposed in the schema, and how. If you use the V4 preset
then we'll automatically translate the old smart tags into their behavior
equivalents, so you shouldn't need to worry too much about this right now. We
do advise that you migrate to the behavior system though, it's much more
powerful.

## Running

### CLI

You can run V5 with the `postgraphile` command. Now that it automatically reads
the `graphile.config.js` file you should use that for advanced configuration of
the PostGraphile CLI rather than sending loads of CLI flags.

Currently the main options are:

- `-P` - the preset to use, e.g. `-P postgraphile/presets/amber`
- `-p` - the port to listen on; if not set then it will try and use `5678` but
  _will fallback to a system-assigned port_ so be sure to set this in
  production!
- `-n` - the host to listen on; defaults to 'localhost' (you may want to change
  to '0.0.0.0' in Docker or similar environments)
- `-c postgres://...` - your connection string (same as in V4)
- `-S postgres://...` - your superuser connection string (replaces V4's
  `-C`/`--owner-connection` flag)
- `-s app_public` - your list of PostgreSQL schemas (same as in V4)
- `-e` - enable "explain" - this allows GraphiQL (now called Ruru) to render the
  operation plan and SQL queries that were executed
- `-C` - the config file to load; if not set we'll try and load
  `graphile.config.js` (or similar) but won't raise an error if it doesn't exist

Example:

```bash
postgraphile -P postgraphile/presets/amber -c postgres:///my_db_name -s public -e
```

### Library mode

Load your config from your `graphile.config.js` file and feed it into the
`postgraphile` function to get a `pgl` PostGraphile instance. In V4 this would
have been a middleware, but [Grafserv][] has much more native support for the
various JS webservers than we had in V5, which has necessitated a different
approach, so instead you get a collection of helper methods.

Load the correct [Grafserv][] adaptor for the JS server that you're using, and
feed this into `pgl.createServ(grafserv)` to get a `serv` Grafserv instance.
Finally mount the `serv` instance into your server of choice using the API your
chosen Grafserv adaptor recommends (typically `serv.addTo(...)`).

Here's a simple example using the Node built-in HTTP server:

```ts title="server.js"
import preset from "./graphile.config.js";
import { postgraphile } from "postgraphile";
// This is the import for 'node', there are many other adaptors for different frameworks
import { grafserv } from "grafserv/node";
import { createServer } from "node:http";

// Create an HTTP server
const server = createServer();
server.on("error", (e) => console.error(e));

// Create a PostGraphile instance (pgl)
const pgl = postgraphile(preset);
// Create a Grafserv (server adaptor) instance for this PostGraphile instance
const serv = pgl.createServ(grafserv);
// Attach a request handler to the server
serv.addTo(server);

// Start the server
server.listen(preset.grafserv?.port ?? 5678);
```

:::note

Other servers will have slightly different code, please see the [Grafserv][]
documentation for details.

:::

:::tip

Node.js' `http.createServer()` does _not_ need to be passed a request handler -
you can attach one later via `server.on('request', handler)` - this is exactly
what we do behind the scenes in the example above. The reason for this approach
is that it gives us a chance to also add a `server.on('upgrade', ...)` handler
for dealing with websockets if `preset.grafserv.websockets` is `true`.

:::

### Schema only mode

`createPostGraphileSchema` is now just `makeSchema` (and can be imported from
`postgraphile` or `graphile-build` - your choice). It only accepts one argument
now - the preset that you'd load from your `graphile.config.js` (or similar)
file.

There is no need for `withPostGraphileContext` any more; the context no longer
has a lifecycle that needs to be carefully managed. Just run the query through
`grafast` as you normally would through `graphql`.

The `context` will still need to be generated however. The easy option is to
have this done automatically by additionally passing the `resolvedPreset` and a
`requestCtx` object to `grafast`:

```ts title="schema-only.mjs"
import { grafast } from "grafast";
import { makeSchema } from "postgraphile";
import preset from "./graphile.config.js";

const { schema, resolvedPreset } = await makeSchema(preset);

const args = {
  schema,
  source: /* GraphQL */ `
    query MyQuery {
      __typename
    }
  `,
};
const requestCtx = {};
const result = await grafast(args, resolvedPreset, requestCtx);
console.dir(result);
```

Alternatively, you can use the `hookArgs` method to hook the execution args and
attach all the relevant context data to it based on your preset and its
plugins. This is somewhat more involved, please see the [schema only
usage](../usage-schema.md) documentation for that.

## Server

PostGraphile's HTTP server has been replaced with [Grafserv][], our new
ultra-fast general purpose Gra*fast*-powered GraphQL server. Currently this
doesn't support the same hooks that V4's server did, but we can certainly extend
the hooks support over time. If there's a particular hook you need, please reach
out.

## GraphiQL

Our beloved PostGraphiQL has been transformed into a more modern general purpose
GraphiQL called [Ruru][]. This still integrates into the server, but you can
also run it directly from the command line now too! It doesn't have a plugin
system yet, but it will :grin:

## Plugins

The plugin architecture has been transformed: whereas plugins previously were
functions, they are now declarative objects. For example a plugin that adds the
`Query.four` field might have looked like this in V4:

```js title="V4AddQueryFourFieldPlugin.js"
// Version 4 example; will not work with V5!
module.exports = (builder) => {
  builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
    const {
      graphql: { GraphQLInt },
    } = build;
    const { Self } = context;
    if (Self.name !== "Query") return fields;
    return build.extend(
      fields,
      {
        four: {
          type: GraphQLInt,
          resolve() {
            return 4;
          },
        },
      },
      "Adding Query.four",
    );
  });
};
```

In V5 the equivalent would be:

```js title="V5AddQueryFourFieldPlugin.js"
const { constant } = require("grafast");

module.exports = {
  name: "AddQueryFourFieldPlugin",
  version: "0.0.0",
  schema: {
    hooks: {
      GraphQLObjectType_fields(fields, build, context) {
        const {
          graphql: { GraphQLInt },
        } = build;
        const { Self } = context;
        if (Self.name !== "Query") return fields;
        return build.extend(
          fields,
          {
            four: {
              type: GraphQLInt,
              plan() {
                return constant(4);
              },
            },
          },
          "Adding Query.four",
        );
      },
    },
  },
};
```

The callback itself is very similar, the hook name has been renamed to use
underscores instead of colons (`GraphQLObjectType:fields` ->
`GraphQLObjectType_fields`), and rather than explicitly calling a `hook`
function to register it, it's implicitly registered by being part of the plugin
object.

This new structure allows the system to learn more about the plugin before
actually running it, and can improve the debugging messages when things go
wrong.

Keep in mind that we no longer have the lookahead system (so
`addArgDataGenerator` and its ilk no longer exist), instead we use [Gra*fast* plan
resolvers][].

## Plans, not resolvers

The new system uses [Gra*fast*][grafast] which has a plan based system, so
rather than writing traditional GraphQL resolvers for each field, you will write
[Gra*fast* plan resolvers][]. This makes the system a lot more powerful and is a
lot more intuitive than our lookahead system once you've spent a little time
learning it. It also completely removes the need for old awkward-to-use
directives such as `@pgQuery` and `@requires`! (See
[makeExtendSchemaPlugin migration](./make-extend-schema-plugin) for details on
migrating these directives.)

## Introspection

`build.pgIntrospectionResultsByKind` is no more; instead we have a new library
[pg-introspection][] that takes care of introspection and has parts of the
PostgreSQL documentation built in via TypeScript hints.

The schema build process has been split into two phases:

- `gather`: looks at the introspection results and uses them to generate
  sources, codecs, relations and behaviors (the 4 building blocks)
- `schema`: looks at these sources, codecs, relations and behaviors and
  generates a GraphQL schema from them

Generally introspection data is not available during the `schema` phase; which
also means that you can manually write your own
sources/codecs/relations/behaviors and have a GraphQL schema autogenerated by
them independent of what your PostgreSQL schema actually is!

## Introspection cache

There is no introspection cache any more, so no `--read-cache`, `--write-cache`,
`readCache` or `writeCache`. Instead you can build the GraphQL schema and then
[export it as executable code](../exporting-schema.md) using
`graphile-export`. In production you simply run this exported
code - there's no need for database introspection, schema building plugins,
etc - and you instantly get your schema without the complexities (or
dependencies!) required in building it dynamically.

## `buildSchema`

`buildSchema` is now synchronous - you need to run the asynchronous gather phase
first. The arguments have also changed: first is the preset (this encompasses
the list of plugins which was previously the first argument, and any settings
which were previously the second argument), second comes the result of gather
and finally comes the shared object which contains inflection.

```js
import { resolvePresets } from "graphile-config";
import { buildInflection, gather, buildSchema } from "graphile-build";
import preset from "./graphile.config.js";

const resolvedPreset = resolvePresets([preset]);
const shared = { inflection: buildInflection(resolvedPreset) };
const input = await gather(resolvedPreset, shared);
const schema = buildSchema(resolvedPreset, input, shared);
```

## `postgraphile-core`

`postgraphile-core` is no more (look ma, I'm a poet!); here's how to replace
`createPostGraphileSchema`:

Before:

```js
import { createPostGraphileSchema } from "postgraphile-core";

// ...

const schema = await createPostGraphileSchema(DATABASE_URL, "public", {
  // options
});
```

After:

```js
import { makeSchema } from "postgraphile";
import preset from "./graphile.config.js";

const { schema, resolvedPreset } = await makeSchema(preset);
```

[grafast]: https://grafast.org
[ruru]: https://grafast.org/ruru
[gra*fast* plan resolvers]: https://grafast.org/grafast/plan-resolvers
[grafserv]: https://grafast.org/grafserv
[pg-introspection]: https://npmjs.com/package/pg-introspection
[exporting schema]: ../exporting-schema
