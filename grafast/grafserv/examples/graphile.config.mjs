// These imports are just for the types; if you're pure JS you don't need them
import "graphile-config";
import "grafserv";
import "grafserv/express/v4";
import "grafserv/koa/v2";
import "grafserv/fastify/v4";

/** @type {GraphileConfig.Preset} */
const preset = {
  server: {
    port: 5678,
    outputDataAsString: true,
    graphqlOverGET: true,
    graphiqlOnGraphQLGET: true,
  },
  grafast: {
    context(requestContext) {
      return {
        user_id: requestContext.http?.getHeader("x-user-id"),
        expressThing: requestContext.http?.meta.expressv4?.req.thing,
        koaThing: requestContext.http?.meta.koav2?.ctx.thing,
        fastifyThing: requestContext.http?.meta.fastifyv4?.request.thing,
      };
    },
  },
};
export default preset;
