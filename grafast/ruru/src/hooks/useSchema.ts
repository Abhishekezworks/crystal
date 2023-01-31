import type { GraphiQLProps } from "graphiql";
import { GraphQLError, GraphQLSchema } from "graphql";
import { buildClientSchema, getIntrospectionQuery } from "graphql";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { RuruProps } from "../interfaces.js";
// import { updateGraphiQLDocExplorerNavStack } from "../updateGraphiQLDocExplorerNavStack.js";
import { useGraphQLChangeStream } from "./useGraphQLChangeStream.js";

export const useSchema = (
  props: RuruProps,
  fetcher: GraphiQLProps["fetcher"],
  setError: Dispatch<SetStateAction<Error | null>>,
  streamEndpoint: string | null,
) => {
  const [schema, setSchema] = useState<GraphQLSchema | null>(null);
  const refetchStatusRef = useRef({
    inProgress: false,
    fetchAgain: null as null | typeof refetch,
  });
  const refetch = useCallback(() => {
    if (refetchStatusRef.current.inProgress) {
      refetchStatusRef.current.fetchAgain = refetch;
      return;
    }
    refetchStatusRef.current.inProgress = true;
    refetchStatusRef.current.fetchAgain = null;
    (async () => {
      // Fetch the schema using our introspection query and report once that has
      // finished.
      const result = await fetcher({
        query: getIntrospectionQuery(),
        // TODO: remove this TypeScript hack once https://github.com/graphql/graphiql/pull/2373 is merged/released
        operationName: null as unknown as string,
      });
      let payload;
      if (typeof result.next === "function") {
        // Handle async iterator; we're only expecting a single payload.
        for await (const entry of result) {
          payload = entry;
        }
      } else {
        payload = result;
      }
      const { data, errors } = payload;
      if (errors) {
        if (errors[0]) {
          throw new GraphQLError(
            errors[0].message ?? "Error has no message?!",
            null,
            null,
            null,
            errors[0].path,
            null,
            errors[0].extensions,
          );
        } else {
          throw new Error(
            "'errors' was set on the payload, but was empty or contained null? This is forbidden by the GraphQL spec.",
          );
        }
      }

      // Use the data we got back from GraphQL to build a client schema (a
      // schema without resolvers).
      const schema = buildClientSchema(data);
      setSchema(schema);
      setError(null);

      console.log("Ruru: Schema updated");
    })()
      .catch((error) => {
        console.error("Error occurred when updating the schema:");
        console.error(error);
        setError(
          new Error(
            `Introspecting the GraphQL schema failed; please check the endpoint and try again.\n${String(
              error,
            )}`,
          ),
        );
      })
      .finally(() => {
        refetchStatusRef.current.inProgress = false;
        if (refetchStatusRef.current.fetchAgain) {
          refetchStatusRef.current.fetchAgain();
        }
      });
  }, [fetcher, setError]);
  useGraphQLChangeStream(props, refetch, streamEndpoint);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { schema };
};
