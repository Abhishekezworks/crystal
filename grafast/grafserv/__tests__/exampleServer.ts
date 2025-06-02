import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";

import { constant, error, makeGrafastSchema } from "grafast";
import { resolvePreset } from "graphile-config";

import { GrafservBase } from "../src/index.js";
import { grafserv as grafservNode } from "../src/servers/node/index.js";
import { grafserv as grafservWhatwg } from "../src/servers/whatwg-node-server";

export async function makeExampleServer(
  preset: GraphileConfig.Preset = {
    grafserv: {
      graphqlOverGET: true,
      graphqlPath: "/graphql",
      dangerouslyAllowAllCORSRequests: true,
    },
  },
  type?: "node" | "whatwg",
) {
  const resolvedPreset = resolvePreset(preset);
  const schema = makeGrafastSchema({
    typeDefs: /* GraphQL */ `
      type Query {
        hello: String!
        throwAnError: String
      }
    `,
    plans: {
      Query: {
        hello() {
          return constant("world");
        },
        throwAnError() {
          return error(new Error("You asked for an error... Here it is."));
        },
      },
    },
  });

  let serv: GrafservBase;
  let server: ReturnType<typeof createServer>;
  switch (type) {
    case "whatwg":
      const servWhatwg = grafservWhatwg({ schema, preset });
      server = createServer(servWhatwg.createHandler());
      serv = servWhatwg;
      break;
    case "node":
    default:
      const servNode = grafservNode({ schema, preset });
      server = createServer();
      servNode.addTo(server);
      serv = servNode;
      break;
  }
  const promise = new Promise<void>((resolve, reject) => {
    server.on("listening", () => {
      server.off("error", reject);
      resolve();
    });
    server.on("error", reject);
  });
  server.listen();
  await promise;
  const info = server.address() as AddressInfo;
  const url = `http://${
    info.family === "IPv6"
      ? `[${info.address === "::" ? "::1" : info.address}]`
      : info.address
  }:${info.port}${resolvedPreset.grafserv!.graphqlPath}`;

  const release = () => {
    serv.release();
    server.close();
    server.closeAllConnections();
  };
  return { url, release };
}

if (require.main === module) {
  const serverPromise = makeExampleServer();
  serverPromise.then(
    (server) => {
      console.log(server.url);
    },
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
