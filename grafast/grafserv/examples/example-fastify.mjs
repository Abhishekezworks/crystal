import Fastify from "fastify";
import { grafserv } from "grafserv/fastify/v4";
import preset from "./graphile.config.mjs";
import schema from "./schema.mjs";

// Create a Fastify app
const app = Fastify({
  logger: true,
});
// (Add any Fastify middleware you want here.)
// await app.register(websocket);
app.addHook("onRequest", async (request, _reply) => {
  request.thing = "Hello from Fastify!";
});

// Create a Grafserv instance
const serv = grafserv({ schema, preset });

// Add the Grafserv instance's route handlers to the Fastify app
serv.addTo(app).catch((e) => {
  console.error(e);
  process.exit(1);
});

// Start the Fastify server
app.listen({ port: preset.server.port ?? 5678 }, (err, address) => {
  if (err) throw err;
  console.log(`Server is now listening on ${address}`);
});
