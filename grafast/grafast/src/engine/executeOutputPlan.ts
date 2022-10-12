import type { GraphQLError } from "graphql";

import * as assert from "../assert.js";
import type { Bucket, RequestContext } from "../bucket.js";
import { isDev } from "../dev.js";
import type { JSONValue } from "../interfaces.js";
import type { OutputPlan } from "./OutputPlan.js";

export type OutputPath = Array<string | number>;
export interface OutputStream {
  asyncIterable: AsyncIterableIterator<any>;
}

/**
 * PayloadRoot handles the root-level of a payload, it's ultimately responsible
 * for sharing the `data`/`errors` with the user. But it also handles the
 * intermediate payloads for stream/defer.
 *
 * A standard GraphQL query/mutation request (one that doesn't use
 * `@stream`/`@defer`) will have just one payload. A standard GraphQL
 * subscription request gets one payload per subscription event.
 *
 * When we mix `@stream` and `@defer` into this, we will require (often quite a
 * lot) more payloads.
 *
 * @internal
 */
export interface PayloadRoot {
  /**
   * Serialization works differently if we're running inside GraphQL. (Namely:
   * we don't serialize - that's GraphQL's job.)
   */
  insideGraphQL: boolean;

  /**
   * The errors that have occurred; these are proper GraphQLErrors and will be
   * returned directly to clients so they must be complete.
   */
  errors: GraphQLError[];

  /**
   * Defer queue - we don't start executing these until after the main
   * payload is completed (to allow for a non-null boundary to abort
   * execution).
   */
  queue: Array<SubsequentPayloadSpec>;

  /**
   * Stream queue - we don't start executing these until after the main
   * payload is completed (to allow for a non-null boundary to abort
   * execution).
   */
  streams: Array<SubsequentStreamSpec>;

  /**
   * VERY DANGEROUS. This is _only_ to pass variables through to introspection
   * selections, it shouldn't be used for anything else.
   *
   * @internal
   * */
  variables: { [key: string]: any };
}

export interface OutputPlanContext {
  requestContext: RequestContext;
  root: PayloadRoot;
  path: ReadonlyArray<string | number>;
}

export interface SubsequentPayloadSpec {
  // TODO: abort this stream if an error occurred in this path
  // See: https://github.com/robrichard/defer-stream-wg/discussions/45#discussioncomment-3486994

  root: PayloadRoot;
  path: ReadonlyArray<string | number>;
  bucket: Bucket;
  bucketIndex: number;
  outputPlan: OutputPlan;
  label: string | undefined;
}

export interface SubsequentStreamSpec {
  // TODO: abort this stream if an error occurred in this path
  // See: https://github.com/robrichard/defer-stream-wg/discussions/45#discussioncomment-3486994

  root: PayloadRoot;
  path: ReadonlyArray<string | number>;
  bucket: Bucket;
  bucketIndex: number;
  outputPlan: OutputPlan;
  label: string | undefined;
  stream: AsyncIterableIterator<any>;
  startIndex: number;
}

// TODO: to start with we're going to do looping here; but later we can compile
// the output plans (even nested ones) into simple functions that just generate
// the resulting objects directly without looping.
/**
 * @internal
 */
export function executeOutputPlan(
  ctx: OutputPlanContext,
  outputPlan: OutputPlan,
  bucket: Bucket,
  bucketIndex: number,
  asString: boolean,
): JSONValue {
  if (isDev) {
    assert.strictEqual(
      bucket.isComplete,
      true,
      "Can only process an output plan for a completed bucket",
    );
  }
  const mutablePath = ["SOMEONE_FORGOT_TO_SLICE_THE_PATH!", ...ctx.path];
  return asString
    ? outputPlan.executeString(ctx.root, mutablePath, bucket, bucketIndex)
    : outputPlan.execute(ctx.root, mutablePath, bucket, bucketIndex);
}
