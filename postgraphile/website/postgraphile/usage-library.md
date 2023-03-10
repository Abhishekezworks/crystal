---
title: Usage - Library
---

# Using PostGraphile as a Library

Library mode is the most popular way of running PostGraphile; it gives more
power than using the CLI (see [CLI usage](./usage-cli/)) because you can
leverage the capabilities and ecosystems of your chosen Node.js webserver
(Express, Koa, Fastify, etc), but is more fully featured than [Schema-only
Usage](./usage-schema/).

## PostGraphile instance

Library mode is configured using a preset (see [Configuration](./config.md) for
the options) and returns a PostGraphile instance which has various
methods you can use depending on what you're trying to do.

```js title="pgl.js"
import preset from "./graphile.config.js";
import postgraphile from "postgraphile";

// Our PostGraphile instance:
export const pgl = postgraphile(preset);
```

### `pgl.createServ(grafserv)`

[Grafserv][] supports a number of different servers in the JS ecosystem, you
should import the `grafserv` function from the relevant grafserv subpath (e.g.
for Express you would `import { grafserv } from "grafserv/express/v4"`) and
feed that into the `pgl.createServ(grafserv)` method. This will return a
Grafserv instance that can be mounted inside of your chosen server - for
instructions on how to do that, please see the relevant entry for your server
of choice in the Grafserv documentation.

Here's an example with Node's HTTP server:

```js title="example-node.js"
import { createServer } from "node:http";
import { grafserv } from "grafserv/node";
import { pgl } from "./pgl.js";

const serv = pgl.createServ(grafserv);

const server = createServer();
server.on("error", (e) => {
  console.error(e);
});

serv.addTo(server).catch((e) => {
  console.error(e);
  process.exit(1);
});

server.listen(5678);

console.log("Server listening at http://localhost:5678");
```

And an example for Express:

```js title="example-express.js"
import { createServer } from "node:http";
import express from "express";
import { grafserv } from "grafserv/express/v4";
import { pgl } from "./pgl.js";

const serv = pgl.createServ(grafserv);

const app = express();
const server = createServer(app);
server.on("error", () => {});
serv.addTo(app, server).catch((e) => {
  console.error(e);
  process.exit(1);
});
server.listen(5678);

console.log("Server listening at http://localhost:5678");
```

For information about using PostGraphile with Connect, Express, Koa, Fastify,
Restify, or any other HTTP servers, please see the [Grafserv
documentation][grafserv].

### `pgl.getSchemaResult()`

:::warning

This will likely be renamed before the V5.0.0 release.

:::

Returns a promise to the schema result - an object containing:

- `schema` - the GraphQL schema
- `resolvedPreset` - the resolved preset

Note that this may change over time, e.g. in watch mode.

### `pgl.getSchema()`

Shortcut to `(await getSchemaResult()).schema` - the current GraphQL schema the
instance represents (may change due to watch mode).

### `pgl.getResolvedPreset()`

Get the current resolved preset that PostGraphile is using. Synchronous.

### `pgl.release()`

Call this when you don't need the PostGraphile instance any more and it will
release any resources it holds (for example schema watching, etc).

[grafserv]: https://grafast.org/grafserv/
