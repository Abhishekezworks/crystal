import LRU from "@graphile/lru";
import debugFactory from "debug";
import type {
  FragmentDefinitionNode,
  GraphQLSchema,
  OperationDefinitionNode,
} from "graphql";

import { matchesConstraints } from "./constraints.js";
import { isDev, noop } from "./dev.js";
import { OperationPlan } from "./index.js";
import type {
  BaseGraphQLRootValue,
  BaseGraphQLVariables,
} from "./interfaces.js";

const debug = debugFactory("grafast:establishOperationPlan");

type Fragments = {
  [key: string]: FragmentDefinitionNode;
};

interface LinkedList<T> {
  value: T;
  next: LinkedList<T> | null;
}

/**
 * This represents the list of possible opPlans for a specific document.
 *
 * @remarks
 *
 * It also includes the fragments for validation, but generally we trust that
 * if the OperationDefinitionNode is the same then the request is equivalent.
 */
interface Cache {
  /**
   * Implemented as a linked list so the hot opPlans can be kept at the top of the
   * list, and if the list grows beyond a maximum size we can drop the last
   * element.
   */
  possibleOpPlans: LinkedList<OperationPlan>;
  fragments: Fragments;
}

/**
 * The starting point for finding/storing the relevant OperationPlan for a request.
 */
type CacheByOperation = LRU<OperationDefinitionNode, Cache>;

/**
 * This is a development-only validation to check fragments do, in fact, match
 * - even if the objects themselves differ.
 */
function reallyAssertFragmentsMatch(
  oldFragments: Fragments,
  fragments: Fragments,
): void {
  if (oldFragments !== fragments) {
    debug("fragments aren't `===` for same operation");
    // Consistency check - we assume that if the operation is the same then
    // the fragments will be, but this may not be the case depending on if
    // GraphQL.js caches the operation node.
    const oldKeys = Object.keys(oldFragments).sort();
    const newKeys = Object.keys(fragments).sort();
    const oldKeyStr = oldKeys.join(",");
    const newKeyStr = newKeys.join(",");
    if (oldKeyStr.length !== newKeyStr.length) {
      throw new Error(
        `Inconsistency error: operation matches, but fragment keys differ: '${oldKeyStr}' != '${newKeyStr}'.`,
      );
    }
    for (const key of newKeys) {
      if (oldFragments[key] !== fragments[key]) {
        throw new Error(
          `Inconsistency error: operation matches, fragment names match, but fragment '${key}' is not '===' to the previous value.`,
        );
      }
    }
  }
}

// Optimise this away in production.
const assertFragmentsMatch = !isDev ? noop : reallyAssertFragmentsMatch;

/**
 * Implements the `IsOpPlanCompatible` algorithm.
 *
 * @remarks Due to the optimisation in `establishOperationPlan`, the schema, document
 * and operationName checks have already been performed.
 */
function isOpPlanCompatible<
  TVariables extends BaseGraphQLVariables = BaseGraphQLVariables,
  TContext extends Grafast.Context = Grafast.Context,
  TRootValue extends BaseGraphQLRootValue = BaseGraphQLRootValue,
>(
  opPlan: OperationPlan,
  variableValues: TVariables,
  context: TContext,
  rootValue: TRootValue,
): opPlan is OperationPlan {
  const {
    variableValuesConstraints,
    contextConstraints,
    rootValueConstraints,
  } = opPlan;
  if (!matchesConstraints(variableValuesConstraints, variableValues)) {
    return false;
  }
  if (!matchesConstraints(contextConstraints, context)) {
    return false;
  }
  if (!matchesConstraints(rootValueConstraints, rootValue)) {
    return false;
  }
  return true;
}

/**
 * We store the cache directly onto the GraphQLSchema so that it gets garbage
 * collected along with the schema when it's not needed any more. To do so, we
 * attach it using this symbol.
 */
const $$cacheByOperation = Symbol("cacheByOperation");

declare module "graphql" {
  interface GraphQLSchema {
    [$$cacheByOperation]?: CacheByOperation;
  }
}

/**
 * Implements the `EstablishOpPlan` algorithm.
 *
 * @remarks Though EstablishOpPlan accepts document and operationName, we
 * instead accept operation and fragments since they're easier to get a hold of
 * in GraphQL.js.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function establishOperationPlan<
  TVariables extends BaseGraphQLVariables = BaseGraphQLVariables,
  TContext extends Grafast.Context = Grafast.Context,
  TRootValue extends BaseGraphQLRootValue = BaseGraphQLRootValue,
>(
  schema: GraphQLSchema,
  operation: OperationDefinitionNode,
  fragments: Fragments,
  variableValues: TVariables,
  context: TContext,
  rootValue: TRootValue,
): OperationPlan {
  let cacheByOperation = schema[$$cacheByOperation];

  let cache = cacheByOperation?.get(operation);

  // These two variables to make it easy to trim the linked list later.
  let count = 0;
  let lastButOneItem: LinkedList<OperationPlan> | null = null;

  if (cache) {
    // Dev-only validation
    assertFragmentsMatch(cache.fragments, fragments);

    let previousItem: LinkedList<OperationPlan> | null = null;
    let linkedItem: LinkedList<OperationPlan> | null = cache.possibleOpPlans;
    while (linkedItem) {
      if (
        isOpPlanCompatible(linkedItem.value, variableValues, context, rootValue)
      ) {
        // Hoist to top of linked list
        if (previousItem) {
          // Remove linkedItem from existing chain
          previousItem.next = linkedItem.next;
          // Add rest of chain after linkedItem
          linkedItem.next = cache.possibleOpPlans;
          // linkedItem is now head of chain
          cache.possibleOpPlans = linkedItem;
        }

        // We found a suitable OperationPlan - use that!
        return linkedItem.value;
      }

      count++;
      lastButOneItem = previousItem;
      previousItem = linkedItem;
      linkedItem = linkedItem.next;
    }
  }

  // No suitable OperationPlan found, time to make one.
  const opPlan = new OperationPlan(
    schema,
    operation,
    fragments,
    variableValues,
    context,
    rootValue,
  );

  // Store it to the cache
  if (!cacheByOperation) {
    // TODO: make this configurable
    cacheByOperation = new LRU({ maxLength: 500 });
    schema[$$cacheByOperation] = cacheByOperation;
  }
  if (!cache) {
    cache = {
      fragments,
      possibleOpPlans: { value: opPlan, next: null },
    };
    cacheByOperation.set(operation, cache);
  } else {
    // TODO: make this configurable
    if (count >= 50) {
      // Remove the tail to ensure we never grow too big
      lastButOneItem!.next = null;
      count--;
      // TODO: we should announce this so that people know there's something that needs fixing in their schema (too much eval?)
    }

    // Add new opPlan to top of the linked list.
    cache.possibleOpPlans = {
      value: opPlan,
      next: cache.possibleOpPlans,
    };
  }

  return opPlan;
}
