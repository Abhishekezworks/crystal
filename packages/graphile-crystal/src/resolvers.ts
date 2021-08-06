import chalk from "chalk";
// import { getAliasFromResolveInfo } from "graphql-parse-resolve-info";
import debugFactory from "debug";
import type {
  GraphQLFieldResolver,
  GraphQLOutputType,
  GraphQLResolveInfo,
} from "graphql";
import {
  assertObjectType,
  defaultFieldResolver,
  getNamedType,
  isInterfaceType,
  isLeafType,
  isListType,
  isNonNullType,
  isUnionType,
} from "graphql";
import type { Path } from "graphql/jsutils/Path";
import { inspect } from "util";

import { populateValuePlan } from "./aether";
import * as assert from "./assert";
import { GLOBAL_PATH, ROOT_PATH } from "./constants";
import type { Deferred } from "./deferred";
import { defer } from "./deferred";
import { isDev } from "./dev";
import { establishAether } from "./establishAether";
import type { Batch, CrystalContext, CrystalObject } from "./interfaces";
import {
  $$concreteData,
  $$concreteType,
  $$crystalContext,
  $$crystalObjectByPathIdentity,
  $$data,
  $$id,
  $$indexes,
  $$indexesByPathIdentity,
  $$pathIdentity,
} from "./interfaces";
import type { ExecutablePlan } from "./plan";
import { __ValuePlan } from "./plans";
import { assertPolymorphicData } from "./polymorphic";
import type { UniqueId } from "./utils";
import {
  crystalPrint,
  crystalPrintPathIdentity,
  ROOT_VALUE_OBJECT,
  uid,
} from "./utils";

const debug = debugFactory("crystal:resolvers");

/*
 * This was the original, simple implementation. Below we rewrote this to avoid
 * recursion for performance reasons.
 *
function pathToPathIdentityRecursive(path: Path): string {
  // Skip over list keys.
  if (!path.typename) {
    assert.ok(
      path.prev,
      "Path has no `typename` and no `prev`; seems like an invalid Path?",
    );
    return pathToPathIdentity(path.prev);
  }
  return (
    (path.prev ? pathToPathIdentity(path.prev) : ROOT_PATH) +
    `>${path.typename}.${path.key}`
  );
}
*/

function pathToPathIdentity(initialPath: Path): string {
  /**
   * We're building the pathIdentity from the end backwards, so this represents
   * the tail.
   */
  let tailPathIdentity = "";
  let path: Path | undefined = initialPath;
  while (path) {
    // Skip over list keys.
    if (path.typename) {
      tailPathIdentity = `>${path.typename}.${path.key}${tailPathIdentity}`;
    }
    path = path.prev;
  }
  return `${ROOT_PATH}${tailPathIdentity}`;
}

export const $$crystalWrapped = Symbol("crystalWrappedResolver");

/**
 * Given a `resolve` function, wraps the function so that it can perform the
 * `ResolveFieldValueCrystal` algorithm.
 *
 * @param resolve - The resolver function.
 */
export function crystalWrapResolve<
  TSource extends object | null | undefined,
  TContext extends object,
  TArgs = { [argName: string]: any },
>(
  resolve: GraphQLFieldResolver<
    TSource,
    TContext,
    TArgs
  > = defaultFieldResolver,
): GraphQLFieldResolver<TSource, TContext, TArgs> {
  const realResolver = resolve || defaultFieldResolver;
  if (realResolver[$$crystalWrapped]) {
    throw Object.assign(
      new Error("ETOOMUCHBLING: this resolver is already wrapped in crystals."),
      { code: "ETOOMUCHBLING" },
    );
  }
  const getAetherFromResolver = (
    context: TContext,
    info: GraphQLResolveInfo,
  ) => {
    // Note: in the ResolveFieldValueCrystal algorithm it uses `document` and
    // `operationName`; however all it really needs is the `operation` and
    // `fragments`, so that's what we extract here.
    const {
      schema,
      // fieldName,
      operation,
      fragments,
      variableValues,
      rootValue,
    } = info;
    // const alias = getAliasFromResolveInfo(info);
    const aether = establishAether({
      schema,
      operation,
      fragments,
      variableValues,
      context,
      rootValue,
    });
    return aether;
  };

  //const wrapResult = makeResultWrapper(type);
  /**
   * Implements the `ResolveFieldValueCrystal` algorithm.
   */
  const crystalResolver: GraphQLFieldResolver<TSource, TContext, TArgs> =
    async function (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      source: any,
      argumentValues,
      context,
      info,
    ) {
      const parentObject:
        | Exclude<TSource, null | undefined>
        | CrystalObject<any> = source ?? ROOT_VALUE_OBJECT;
      let parentCrystalObject: CrystalObject<any> | null = null;

      // Note: for the most optimal execution, `rootValue` passed to graphql
      // should be a crystal object, this allows using {crystalContext} across
      // the entire operation if plans are used everywhere. Even more optimised
      // would be if we can share the same {crystalContext} across multiple
      // `rootValue`s for multiple parallel executions (must be within the same
      // aether) - e.g. as a result of multiple identical subscription
      // operations.
      if (isCrystalObject(parentObject)) {
        parentCrystalObject = parentObject;
      }

      const aether = parentCrystalObject
        ? parentCrystalObject[$$crystalContext].aether
        : getAetherFromResolver(context, info);
      const { path, parentType, returnType, variableValues, rootValue } = info;
      const pathIdentity = pathToPathIdentity(path);
      const planId = aether.planIdByPathIdentity[pathIdentity];
      if (planId == null) {
        const objectValue = parentCrystalObject
          ? parentCrystalObject[$$data]
          : parentObject;
        debug(
          "Calling real resolver for %s.%s with %o",
          info.parentType.name,
          info.fieldName,
          objectValue,
        );
        return realResolver(objectValue, argumentValues, context, info);
      }
      const plan = aether.plans[planId];
      assert.ok(
        plan != null,
        `Could not find plan with id '${planId}' for path '${pathIdentity}'`,
      );
      /*
      debug(
        "   id for resolver at %p is %c",
        pathIdentity,
        id,
      );
      */
      const batch = aether.getBatch(
        pathIdentity,
        parentCrystalObject,
        variableValues,
        context,
        rootValue,
      );
      const id = uid(info.fieldName);
      debug(`👉 %p/%c for %c`, pathIdentity, id, parentObject);
      const crystalContext = batch.crystalContext;
      if (parentCrystalObject) {
        /* noop */
      } else if (!path.prev) {
        // Special workaround for the root object.
        parentCrystalObject = crystalContext.rootCrystalObject;
      } else {
        // Note: we need to "fake" that the parent was a plan. Because we may
        // have lots of resolvers all called for the same parent object, we use a
        // map. This happens to mean that multiple values in the graph being the
        // same object will be merged automatically.
        const parentPathIdentity = path.prev
          ? pathToPathIdentity(path.prev)
          : "";
        const parentPlanId =
          aether.itemPlanIdByPathIdentity[parentPathIdentity];
        assert.ok(
          parentPlanId != null,
          `Could not find a planId for (parent) path '${parentPathIdentity}'`,
        );
        const parentPlan = aether.plans[parentPlanId]; // TODO: assert that this is handled for us
        assert.ok(
          parentPlan instanceof __ValuePlan,
          "Expected parent field (which returned non-crystal object) to be a valuePlan)",
        );

        const { valueId: parentId, existed } = aether.getValuePlanId(
          crystalContext,
          parentPlan,
          parentObject,
          pathIdentity,
        );
        // TODO: this should extract the true indexes from resolveInfo?
        const indexes: number[] = [];
        parentCrystalObject = newCrystalObject(
          parentPlan,
          parentPathIdentity,
          parentType.name,
          parentId,
          indexes,
          parentObject,
          crystalContext,
        );
        if (!existed) {
          populateValuePlan(
            crystalContext,
            parentPlan,
            parentCrystalObject,
            parentObject,
            "parent",
          );
        }
        debug(
          "   Created a new crystal object to represent the parent of %p: %c",
          pathIdentity,
          parentCrystalObject,
        );
      }
      const result = await getBatchResult(batch, parentCrystalObject);
      debug(
        `👈 %p/%c for %s; result: %o`,
        pathIdentity,
        id,
        parentCrystalObject,
        result,
      );
      if (isLeafType(getNamedType(info.returnType))) {
        const valueForResolver: any = { [info.fieldName]: result };
        debug(
          "   Calling real resolver for %s.%s with %o",
          info.parentType.name,
          info.fieldName,
          valueForResolver,
        );
        return realResolver(valueForResolver, argumentValues, context, info);
      } else {
        const crystalResults = crystalWrap(
          crystalContext,
          plan,
          returnType,
          parentCrystalObject,
          pathIdentity,
          id,
          result,
        );
        return crystalResults;
      }
    };
  Object.defineProperty(crystalResolver, $$crystalWrapped, {
    enumerable: false,
    configurable: false,
  });
  return crystalResolver;
}

/**
 * Given a `subscribe` function, wraps the function so that it can perform the
 * `ResolveFieldValueCrystal` algorithm.
 *
 * @param subscribe - The subscribe function.
 */
export function crystalWrapSubscribe<
  TSource extends object | null | undefined,
  TContext extends object,
  TArgs = { [argName: string]: any },
>(
  subscribe: GraphQLFieldResolver<TSource, TContext, TArgs>,
): GraphQLFieldResolver<TSource, TContext, TArgs> {
  // For now wrapping subscribe and resolve are equivalent; but this might not
  // always be the case.
  return crystalWrapResolve(subscribe);
}

type CrystalWrapResult =
  | null
  | CrystalObject<any>
  | CrystalObjectMultidimensionalList;
type CrystalObjectMultidimensionalList = CrystalObjectMultidimensionalArray;
interface CrystalObjectMultidimensionalArray
  extends Array<CrystalObjectMultidimensionalArray | CrystalObject<any>> {}

function crystalWrap<TData>(
  crystalContext: CrystalContext,
  plan: ExecutablePlan,
  returnType: GraphQLOutputType,
  parentCrystalObject: CrystalObject<any> | undefined,
  pathIdentity: string,
  id: UniqueId,
  data: TData,
  indexes: ReadonlyArray<number> = [],
): CrystalWrapResult {
  // This is an `any` because typing it is way too hard; it could be an infinitely nested list for example.
  if (data == null) {
    return null;
  }
  if (isNonNullType(returnType)) {
    return crystalWrap(
      crystalContext,
      plan,
      returnType.ofType,
      parentCrystalObject,
      pathIdentity,
      id,
      data,
    );
  }
  if (isListType(returnType)) {
    if (!Array.isArray(data)) {
      throw new Error(
        `The field at '${pathIdentity}' returned a value incompatible with '${returnType.toString()}': '${inspect(
          data,
        )}'`,
      );
    }
    const l = data.length;
    const result = new Array(l);
    for (let index = 0; index < l; index++) {
      const entry = data[index];
      const wrappedIndexes = [...indexes, index];
      result[index] = crystalWrap(
        crystalContext,
        plan,
        returnType.ofType,
        parentCrystalObject,
        pathIdentity,
        id,
        entry,
        wrappedIndexes,
      );
    }
    return result;
  }
  let typeName: string;
  let innerData: any;
  if (isUnionType(returnType) || isInterfaceType(returnType)) {
    assertPolymorphicData(data);
    ({ [$$concreteType]: typeName, [$$concreteData]: innerData } = data);
  } else {
    // TODO: is it okay that scalars would throw here?
    assertObjectType(returnType);
    typeName = returnType.name;
    innerData = data;
  }
  if (parentCrystalObject) {
    return newCrystalObject(
      plan,
      pathIdentity,
      typeName,
      id,
      indexes,
      innerData,
      crystalContext,
      parentCrystalObject[$$crystalObjectByPathIdentity],
      parentCrystalObject[$$indexesByPathIdentity],
    );
  } else {
    return newCrystalObject(
      plan,
      pathIdentity,
      typeName,
      id,
      indexes,
      innerData,
      crystalContext,
    );
  }
}

/**
 * Implements `NewCrystalObject`
 */
export function newCrystalObject<TData>(
  plan: ExecutablePlan | null, // TODO: delete this line
  pathIdentity: string,
  typeName: string,
  id: UniqueId,
  indexes: ReadonlyArray<number>,
  data: TData,
  crystalContext: CrystalContext,
  crystalObjectByPathIdentity: {
    [pathIdentity: string]: CrystalObject<any> | undefined;
  } = {
    [GLOBAL_PATH]: crystalContext.rootCrystalObject,
  },
  indexesByPathIdentity: {
    [pathIdentity: string]: ReadonlyArray<number> | undefined;
  } = {
    [GLOBAL_PATH]: [],
  },
): CrystalObject<TData> {
  const crystalObject: CrystalObject<TData> = {
    [$$pathIdentity]: pathIdentity,
    [$$concreteType]: typeName,
    [$$id]: id,
    [$$data]: data,
    [$$indexes]: indexes, // Shortcut to $$indexesByPathIdentity[$$pathIdentity]
    [$$crystalContext]: crystalContext,
    [$$crystalObjectByPathIdentity]: Object.assign(
      Object.create(null),
      crystalObjectByPathIdentity,
    ),
    [$$indexesByPathIdentity]: Object.freeze(
      Object.assign(Object.create(null), {
        ...indexesByPathIdentity,
        [pathIdentity]: indexes,
      }),
    ),
    // @ts-ignore
    toString() {
      const p = indexes.length ? `.${indexes.join(".")}` : ``;
      return chalk.bold.blue(
        `CO(${crystalPrintPathIdentity(pathIdentity)}/${crystalPrint(id)}${p})`,
      );
    },
  };
  crystalObject[$$crystalObjectByPathIdentity][pathIdentity] = crystalObject;
  Object.freeze(crystalObject[$$crystalObjectByPathIdentity]);
  if (isDev) {
    debug(`Constructed %s with data %c`, crystalObject, data);
  }
  return crystalObject;
}

export function isCrystalObject(input: any): input is CrystalObject<any> {
  return typeof input === "object" && input && $$data in input;
}

/**
 * Implements `GetBatchResult`.
 */
function getBatchResult(
  batch: Batch,
  parentCrystalObject: CrystalObject<any>,
): Deferred<any> {
  const deferred = defer();
  batch.entries.push([parentCrystalObject, deferred]);
  return deferred;
}
