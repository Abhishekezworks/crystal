import type LRU from "@graphile/lru";
import type {
  DocumentNode,
  FieldNode,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLScalarType,
} from "graphql";
import {
  executeSync,
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLString,
  isObjectType,
  Kind,
  OperationTypeNode,
} from "graphql";

import * as assert from "../assert.js";
import type { Bucket } from "../bucket.js";
import { isDev } from "../dev.js";
import { $$error } from "../error.js";
import { AccessStep } from "../index.js";
import { inspect } from "../inspect.js";
import type { JSONValue, LocationDetails } from "../interfaces.js";
import { $$concreteType, $$streamMore } from "../interfaces.js";
import { isPolymorphicData } from "../polymorphic.js";
import type { ExecutableStep } from "../step.js";
import { expressionSymbol } from "../steps/access.js";
import type { PayloadRoot } from "./executeOutputPlan.js";
import type { LayerPlan } from "./LayerPlan.js";
import dyk, { DYK, toJSON, stringifyString } from "devil-you-know";

const EMPTY_OBJECT = Object.freeze(Object.create(null));

export type OutputPlanTypeIntrospection = {
  mode: "introspection";
  /**
   * The GraphQL introspection field selection (may include arguments/etc). We
   * can build a GraphQL document from this and issue it to graphql-js rather
   * than replicating that effort.
   */
  field: FieldNode;
  /**
   * The names of the variables used in this document.
   */
  variableNames: string[];
  /**
   * No need to re-run the introspection each time, may as well cache it,
   * right?
   *
   * Key: canonical JSON stringify of the variables used.
   * Value: the GraphQL result (`{data, errors}`) for this.
   */
  introspectionCacheByVariableValues: LRU<string, JSONValue>;
};
export type OutputPlanTypeRoot = {
  /**
   * Always return `{}`
   */
  mode: "root";
  typeName: string;
};
export type OutputPlanTypeObject = {
  /**
   * Return `{}` if non-null
   */
  mode: "object";
  typeName: string;
  deferLabel: string | undefined;
};
export type OutputPlanTypePolymorphicObject = {
  /**
   * Return `{}` if non-null
   */
  mode: "polymorphic";
  typeNames: string[];
  deferLabel: string | undefined;
};
export type OutputPlanTypeArray = {
  /**
   * Return a list of the same length if an array
   */
  mode: "array";
};
export type OutputPlanTypeLeaf = {
  /**
   * Return the value.
   */
  mode: "leaf";
  // stepId: number;
  serialize: GraphQLScalarType["serialize"];
  graphqlType: GraphQLScalarType | GraphQLEnumType;
};
export type OutputPlanTypeNull = {
  mode: "null";
  /** If true, we must always throw an error */
};

/**
 * Thanks to `@stream`, output plans must handle their own nullability concerns
 * and we might need an output plan for any of these:
 *
 * - A concrete object
 * - A polymorphic object
 * - A leaf (enum/scalar)
 * - Something we know will always be null
 * - A list of any of the above
 * - A list of lists
 *
 * In addition to the above, we also need to cover
 *
 * - The root object (which is like a concrete object, except it's never null)
 * - Introspection
 */
export type OutputPlanType =
  | OutputPlanTypeRoot
  | OutputPlanTypeObject
  | OutputPlanTypePolymorphicObject
  | OutputPlanTypeLeaf
  | OutputPlanTypeNull
  | OutputPlanTypeArray
  | OutputPlanTypeIntrospection;

export type OutputPlanKeyValueOutputPlan = {
  type: "outputPlan";
  outputPlan: OutputPlan;
  isNonNull: boolean;
  locationDetails: LocationDetails;
};
export type OutputPlanKeyValueTypeName = {
  type: "__typename";
  locationDetails: LocationDetails;
};
export type OutputPlanKeyValue =
  | OutputPlanKeyValueOutputPlan
  | OutputPlanKeyValueTypeName;
export type OutputPlanKeyValueOutputPlanWithCachedBits =
  OutputPlanKeyValueOutputPlan & {
    layerPlanId: number;
  };

/**
 * Defines a way of taking a layerPlan and converting it into an output value.
 *
 * The result of executing an output plan will be the following:
 *
 * - data?: the data for this layer, could be object, array or leaf (see OutputPlanMode)
 * - errors: a list of errors that occurred (if any), including path details _within the output plan_
 * - streams: a list of streams that were created
 */
export class OutputPlan<TType extends OutputPlanType = OutputPlanType> {
  /** For errors */
  public readonly locationDetails: LocationDetails;

  /**
   * The step that represents the root value. How this is used depends on the
   * OutputPlanMode.
   */
  public readonly rootStep: ExecutableStep;

  /**
   * Appended to the root step when accessed to avoid the need for AccessSteps
   */
  private processRoot: ((value: any) => any) | null = null;

  // TODO: since polymorphic handles branching, we can remove the `typeName` layer from this.
  /**
   * For root/object output plans, the keys to set on the resulting object
   * grouped by the concrete object type name.
   *
   * IMPORTANT: the order of these keys is significant, they MUST match the
   * order in the request otherwise we break GraphQL spec compliance!
   */
  public keys: {
    [key: string]:
      | OutputPlanKeyValueTypeName
      | OutputPlanKeyValueOutputPlanWithCachedBits;
  } = Object.create(null);

  /**
   * For list output plans, the output plan that describes the list children.
   */
  public child: OutputPlan | null = null;
  public childIsNonNull = false;

  /**
   * For polymorphic output plans, the Object output plan for each specific type.
   */
  public childByTypeName: {
    [typeName: string]: OutputPlan<OutputPlanTypeObject>;
  } = Object.create(null);

  /**
   * For object output plan types only.
   */
  public deferredOutputPlans: OutputPlan<
    OutputPlanTypeObject | OutputPlanTypePolymorphicObject
  >[] = [];

  constructor(
    public layerPlan: LayerPlan,
    /**
     * For root, this should always be an object.
     *
     * For object this could represent an object or null.
     *
     * For polymorphic this could represent a polymorphic object or null.
     *
     * For array it's the list itself (or null) and dictates the length of the result.
     *
     * For leaf, it's the leaf plan itself.
     *
     * For `introspection`, `null` it's irrelevant. Use `constant(null)` or whatever.
     */
    rootStep: ExecutableStep,
    public readonly type: TType,
    locationDetails: LocationDetails,
  ) {
    this.locationDetails = locationDetails;
    this.rootStep = rootStep;
    layerPlan.operationPlan.stepTracker.addOutputPlan(this);
  }

  public print(): string {
    const type = this.type;
    switch (type.mode) {
      case "root":
      case "object": {
        return `${this.toString()}\n${Object.entries(this.keys)
          .map(([fieldName, val]) => {
            return `.${fieldName}: ${
              val.type === "__typename"
                ? `__typename(${type.typeName})`
                : val.outputPlan.print().replace(/\n/g, "\n  ") +
                  (val.isNonNull ? "!" : "?")
            }`;
          })
          .join("\n")}`;
      }
      case "polymorphic": {
        return `${this.toString()}\n${Object.entries(this.childByTypeName)
          .map(([typeName, outputPlan]) => {
            return `? ${typeName}: ${outputPlan
              .print()
              .replace(/\n/g, "\n  ")}`;
          })
          .join("\n")}`;
      }
      case "array": {
        return `${this.toString()}\n  ${this.child!.print().replace(
          /\n/g,
          "\n  ",
        )}${this.childIsNonNull ? "!" : "?"}`;
      }
      default: {
        return this.toString();
      }
    }
  }

  toString() {
    return `OutputPlan<${this.type.mode}∈${this.layerPlan.id}!${this.rootStep.id}>`;
  }

  addChild(
    type: GraphQLObjectType | null,
    key: string | null,
    child: OutputPlanKeyValue,
  ): void {
    if (this.type.mode === "root" || this.type.mode === "object") {
      if (isDev) {
        if (typeof key !== "string") {
          throw new Error(
            `GraphileInternalError<7334ec50-23dc-442a-8ffa-19664c9eb79f>: Key must be provided in ${this.type.mode} OutputPlan mode`,
          );
        }
        if (type == null) {
          throw new Error(
            `GraphileInternalError<638cebef-4ec6-49f4-b681-2f390fb1c0fc>: Type must be provided in ${this.type.mode} OutputPlan mode.`,
          );
        }
        if (!isObjectType(type)) {
          throw new Error(
            `GraphileInternalError<eaa87576-1d50-49be-990a-345a9b57b998>: Type must provided in ${this.type.mode} OutputPlan mode must be an object type, instead saw '${type}'.`,
          );
        }
        assert.ok(
          ["root", "object"].includes(this.type.mode),
          "Can only addChild on root/object output plans",
        );
        if (this.keys[key]) {
          throw new Error(
            `GraphileInternalError<5ceecb19-8c2c-4797-9be5-9be1b207fa45>: child already set for key '${key}'`,
          );
        }
      }
      this.keys[key!] =
        child.type === "outputPlan"
          ? {
              ...child,
              layerPlanId: child.outputPlan.layerPlan.id,
            }
          : child;
    } else if (this.type.mode === "array") {
      if (isDev) {
        if (key != null) {
          throw new Error(
            `GraphileInternalError<7de67325-a02f-4619-b118-61bb2d84f33b>: Key must not be provided in ${this.type.mode} OutputPlan mode`,
          );
        }
        assert.ok(type == null, "Array should not specify type");
        if (this.child) {
          throw new Error(
            `GraphileInternalError<07059d9d-a47d-441f-b834-683cca1d856a>: child already set`,
          );
        }
      }
      if (child.type === "outputPlan") {
        this.child = child.outputPlan;
        this.childIsNonNull = child.isNonNull;
      } else {
        throw new Error(
          `GraphileInternalError<7525c854-9145-4c6d-8d60-79c14f040519>: Array child must be an outputPlan`,
        );
      }
    } else if (this.type.mode === "polymorphic") {
      if (isDev) {
        assert.ok(
          type && this.type.typeNames.includes(type.name),
          "GraphileInternalError<566a34ac-1138-4dbf-943e-f704819431dd>: polymorphic output plan can only addChild for a matching type",
        );
        assert.strictEqual(
          key,
          null,
          "GraphileInternalError<4346ebda-a02d-4489-b767-7a6d621a73c7>: addChild for polymorphic OutputPlan should not specify a key",
        );
        assert.ok(
          child.type === "outputPlan",
          "GraphileInternalError<b29285da-fb07-4943-9038-708edc785041>: polymorphic OutputPlan child must be an outputPlan",
        );
        assert.ok(
          child.outputPlan.type.mode === "object",
          "GraphileInternalError<203469c6-4bfa-4cd1-ae82-cc5d0132ca16>: polymorphic OutputPlan child must be an object outputPlan",
        );
      }
      this.childByTypeName[type!.name] = (child as OutputPlanKeyValueOutputPlan)
        .outputPlan as OutputPlan<OutputPlanTypeObject>;
    } else {
      throw new Error(
        `GraphileInternalError<5667df5f-30b7-48d3-be3f-a0065ed9c05c>: Doesn't make sense to set a child in mode '${this.type.mode}'`,
      );
    }
  }

  getLayerPlans(layerPlans = new Set<LayerPlan>()): Set<LayerPlan> {
    // Find all the layerPlans referenced
    layerPlans.add(this.layerPlan);
    if (this.child) {
      if (this.child.layerPlan != this.layerPlan) {
        this.child.getLayerPlans(layerPlans);
      } else {
        throw new Error(
          "GraphileInternalError<4013e05f-b8ed-41ea-a869-204232d02763>: how could the child be in the same layer?",
        );
      }
    }
    for (const key in this.keys) {
      const spec = this.keys[key];
      if (spec.type === "outputPlan") {
        if (spec.outputPlan.layerPlan !== this.layerPlan) {
          spec.outputPlan.getLayerPlans(layerPlans);
          layerPlans.add(spec.outputPlan.layerPlan);
        }
      }
    }
    return layerPlans;
  }

  makeNextStepByLayerPlan(): Record<number, any[]> {
    const layerPlans = this.getLayerPlans();
    const map = Object.create(null);
    for (const layerPlan of layerPlans) {
      map[layerPlan.id] = [];
    }
    return map;
  }

  // This gets replaced with a mode-specific executor
  execute(
    this: OutputPlan,
    _root: PayloadRoot,
    // By just reusing the same path over and over we don't need to allocate
    // more memory for more arrays; but we must be _incredibly_ careful to
    // ensure any changes to it are reversed.
    _mutablePath: Array<string | number>,
    _bucket: Bucket,
    _bucketIndex: number,
  ): JSONValue {
    throw new Error(`OutputPlan.execute has yet to be built!`);
  }

  // This gets replaced with a mode-specific executor
  executeString(
    this: OutputPlan,
    _root: PayloadRoot,
    // By just reusing the same path over and over we don't need to allocate
    // more memory for more arrays; but we must be _incredibly_ careful to
    // ensure any changes to it are reversed.
    _mutablePath: Array<string | number>,
    _bucket: Bucket,
    _bucketIndex: number,
  ): string {
    throw new Error(`OutputPlan.executeString has yet to be built!`);
  }

  optimize(): void {
    const $root = this.layerPlan.operationPlan.dangerouslyGetStep(
      this.rootStep.id,
    );
    if ($root instanceof AccessStep && $root.fallback === undefined) {
      const expressionDetails: [DYK, any] | undefined =
        $root.unbatchedExecute![expressionSymbol];
      if (expressionDetails) {
        // @ts-ignore
        const $parent: ExecutableStep<any> = $root.getDep(0);
        this.layerPlan.operationPlan.stepTracker.setOutputPlanRootStep(
          this,
          $parent,
        );
        const [expression, fallback] = expressionDetails;
        this.processRoot = dyk.run<(value: any) => any>(
          dyk`return value => (value${expression})${
            fallback !== undefined ? dyk` ?? ${dyk.lit(fallback)}` : dyk.blank
          };`,
        );
      }
    }
  }

  finalize(): void {
    // Build the executor
    switch (this.type.mode) {
      case "null": {
        this.execute = nullExecutor;
        this.executeString = nullExecutorString;
        break;
      }
      case "leaf": {
        this.execute = leafExecutor;
        if (
          this.type.graphqlType.serialize === GraphQLID.serialize ||
          this.type.graphqlType.serialize === GraphQLString.serialize
        ) {
          // String types
          this.executeString = stringLeafExecutorString;
        } else if (this.type.graphqlType.serialize === GraphQLInt.serialize) {
          this.executeString = intLeafExecutorString;
        } else if (this.type.graphqlType.serialize === GraphQLFloat.serialize) {
          this.executeString = floatLeafExecutorString;
        } else if (
          this.type.graphqlType.serialize === GraphQLBoolean.serialize
        ) {
          // Boolean type
          this.executeString = booleanLeafExecutorString;
        } else {
          // TODO: we could probably optimize enums too
          this.executeString = leafExecutorString;
        }
        break;
      }
      case "introspection": {
        this.execute = introspectionExecutor;
        this.executeString = introspectionExecutorString;
        break;
      }
      case "polymorphic": {
        this.execute = polymorphicExecutor;
        this.executeString = polymorphicExecutorString;
        break;
      }
      case "array": {
        if (!this.child) {
          throw new Error(
            "GraphileInternalError<48fabdc8-ce84-45ec-ac20-35a2af9098e0>: No child output plan for list bucket?",
          );
        }
        const childIsNonNull = this.childIsNonNull;
        let directLayerPlanChild = this.child.layerPlan;
        while (directLayerPlanChild.parentLayerPlan !== this.layerPlan) {
          const parent = directLayerPlanChild.parentLayerPlan;
          if (!parent) {
            throw new Error(
              `GraphileInternalError<d43e06d8-c533-4e7b-b3e7-af399f19c83f>: Invalid heirarchy - could not find direct layerPlan child of ${this}`,
            );
          }
          directLayerPlanChild = parent;
        }
        const canStream =
          directLayerPlanChild.reason.type === "listItem" &&
          !!directLayerPlanChild.reason.stream;

        if (childIsNonNull) {
          if (canStream) {
            this.execute = arrayExecutor_nonNullable_streaming;
            this.executeString = arrayExecutorString_nonNullable_streaming;
          } else {
            this.execute = arrayExecutor_nonNullable;
            this.executeString = arrayExecutorString_nonNullable;
          }
        } else {
          if (canStream) {
            this.execute = arrayExecutor_nullable_streaming;
            this.executeString = arrayExecutorString_nullable_streaming;
          } else {
            this.execute = arrayExecutor_nullable;
            this.executeString = arrayExecutorString_nullable;
          }
        }
        break;
      }
      case "root":
      case "object": {
        const type = this.type as OutputPlanTypeRoot | OutputPlanTypeObject;
        const digestFieldTypes: {
          [responseKey: string]: {
            fieldType: "__typename" | "outputPlan!" | "outputPlan?";
            sameBucket: boolean;
          };
        } = Object.create(null);
        for (const [responseKey, spec] of Object.entries(this.keys)) {
          digestFieldTypes[responseKey] = {
            fieldType:
              spec.type === "__typename"
                ? "__typename"
                : spec.isNonNull
                ? "outputPlan!"
                : "outputPlan?",
            sameBucket:
              spec.type === "__typename" ||
              spec.outputPlan.layerPlan.id === this.layerPlan.id,
          };
        }
        this.execute = makeObjectExecutor(
          type.typeName,
          digestFieldTypes,
          this.deferredOutputPlans.length > 0,
          type.mode === "root",
          false,
        );
        this.executeString = makeObjectExecutor(
          type.typeName,
          digestFieldTypes,
          this.deferredOutputPlans.length > 0,
          type.mode === "root",
          true,
        );
        break;
      }
      default: {
        const never: never = this.type;
        throw new Error(
          `GraphileInternalError<e88531b2-d9af-4d3a-8cd5-e9f034324341>: Could not build executor for OutputPlan with type ${inspect(
            never,
          )}}`,
        );
      }
    }
  }
}

export function coerceError(
  error: Error,
  locationDetails: LocationDetails,
  path: ReadonlyArray<string | number>,
): GraphQLError {
  // Ensure it's a GraphQL error
  if (error instanceof GraphQLError) {
    if (error.path) {
      return error;
    } else {
      return new GraphQLError(
        error.message,
        locationDetails.node,
        null,
        null,
        path,
        error.originalError,
        null,
      );
    }
  } else {
    return new GraphQLError(
      error.message,
      locationDetails.node,
      null,
      null,
      path,
      error,
      null,
    );
  }
}

export function nonNullError(
  locationDetails: LocationDetails,
  path: readonly (string | number)[],
): GraphQLError {
  const { parentTypeName, fieldName, node } = locationDetails;
  if (!parentTypeName || !fieldName) {
    return new GraphQLError(
      // TODO: rename. Also this shouldn't happen?
      `GraphileInternalError<a3706bba-4f88-4643-8a47-2fe2eaaadbea>: null bubbled to root`,
      node,
      null,
      null,
      path,
      null,
      null,
    );
  }
  return new GraphQLError(
    `Cannot return null for non-nullable field ${parentTypeName}.${fieldName}.`,
    node,
    null,
    null,
    path,
    null,
    null,
  );
}

/**
 * We're currently running OutputPlan `outputPlan` in bucket `bucket` at index
 * `bucketIndex`. If this is an array OutputPlan then we're looping over the
 * entries in our list and we're currently at index `inArrayIndex` (otherwise
 * this is null).
 *
 * Now we want to run `childOutputPlan`, but to do so we need to find the
 * related `childBucket` and `childBucketIndex`.
 *
 * @internal
 */
export function getChildBucketAndIndex(
  childOutputPlan: OutputPlan,
  outputPlan: OutputPlan | null,
  bucket: Bucket,
  bucketIndex: number,
  arrayIndex: number | null = null,
): [Bucket, number] | null {
  if (
    (arrayIndex == null) ===
    (outputPlan != null && outputPlan.type.mode === "array")
  ) {
    throw new Error(
      "GraphileInternalError<83d0e3cc-7eec-4185-85b4-846540288162>: arrayIndex must be supplied iff outputPlan is an array",
    );
  }
  if (outputPlan && childOutputPlan.layerPlan === bucket.layerPlan) {
    // Same layer; straightforward
    return [bucket, bucketIndex];
  }

  const reversePath = [childOutputPlan.layerPlan];
  let current: LayerPlan | null = childOutputPlan.layerPlan;
  while (!bucket.children[current.id]) {
    current = current.parentLayerPlan;
    if (!current) {
      return null;
    }
    reversePath.push(current);
  }

  let currentBucket = bucket;
  let currentIndex = bucketIndex;

  for (let l = reversePath.length, i = l - 1; i >= 0; i--) {
    const layerPlan = reversePath[i];
    const child = currentBucket.children[layerPlan.id];
    if (!child) {
      return null;
    }

    const out = child.map.get(currentIndex);
    if (out == null) {
      return null;
    }

    /*
     * TODO: this '|| i > 0' feels really really really hacky... What happens if we have
     * nested arrays? I'm concerned there's a bug here.
     */
    if (arrayIndex == null || i !== l - 1) {
      if (Array.isArray(out)) {
        throw new Error(
          "GraphileInternalError<db189d32-bf8f-4e58-b55f-5c5ac3bb2381>: Was expecting an arrayIndex, but none was provided",
        );
      }
      currentBucket = child.bucket;
      currentIndex = out;
    } else {
      if (!Array.isArray(out)) {
        throw new Error(
          `GraphileInternalError<8190d09f-dc75-46ec-8162-b20ad516de41>: Cannot access array index in non-array ${inspect(
            out,
          )}`,
        );
      }
      if (!(out.length > arrayIndex)) {
        throw new Error(
          `GraphileInternalError<1f596c22-368b-4d0d-94df-fb3df632b064>: Attempted to retrieve array index '${arrayIndex}' which is out of bounds of array with length '${out.length}'`,
        );
      }
      currentBucket = child.bucket;
      currentIndex = out[arrayIndex];
    }
  }
  if (currentIndex == null) {
    return null;
  }
  return [currentBucket, currentIndex];
}

function makeExecutor<TAsString extends boolean>(
  inner: DYK,
  nameExtra: DYK,
  asString: TAsString,
  args: { [key: string]: any } = EMPTY_OBJECT,
  // this.type.mode === "introspection" || this.type.mode === "root"
  skipNullHandling = false,
  preamble: DYK = dyk.blank,
): TAsString extends true
  ? typeof OutputPlan.prototype.executeString
  : typeof OutputPlan.prototype.execute {
  const realArgs = {
    ...args,
    coerceError,
    nonNullError,
    $$error,
  };
  return dyk.run`
${dyk.join(
  Object.entries(realArgs).map(
    ([argName, value]) =>
      dyk`const ${dyk.identifier(argName)} = ${dyk.lit(value)};`,
  ),
  "\n",
)}
return function compiledOutputPlan${
    asString ? dyk`String` : dyk.blank
  }_${nameExtra}(
  root,
  mutablePath,
  bucket,
  bucketIndex,
  rawBucketRootValue = bucket.store.get(this.rootStep.id)[bucketIndex]
) {
  const bucketRootValue = this.processRoot ? this.processRoot(rawBucketRootValue) : rawBucketRootValue;
${preamble}\
  if (bucketRootValue == null) {
    ${
      skipNullHandling
        ? dyk`// root/introspection, null is fine`
        : dyk`return ${asString ? dyk`"null"` : dyk`null`};`
    }
  }${
    skipNullHandling ? dyk` else ` : dyk`\n  `
  }if (typeof bucketRootValue === 'object' && $$error in bucketRootValue) {
    throw coerceError(bucketRootValue.originalError, this.locationDetails, mutablePath.slice(1));
  }
${inner}
}`;
}

function makeExecuteChildPlanCode(
  setTargetOrReturn: DYK,
  locationDetails: DYK,
  childOutputPlan: DYK,
  isNonNull: boolean,
  asString: boolean,
  childBucket: DYK = dyk`childBucket`,
  childBucketIndex: DYK = dyk`childBucketIndex`,
) {
  // This is the code that changes based on if the field is nullable or not
  if (isNonNull) {
    // No need to catch error
    return dyk`
      if (${childBucket} == null) {
        throw nonNullError(${locationDetails}, mutablePath.slice(1));
      }
      const fieldResult = ${childOutputPlan}.${
      asString ? dyk`executeString` : dyk`execute`
    }(root, mutablePath, ${childBucket}, ${childBucketIndex}, ${childBucket}.rootStep === this.rootStep ? rawBucketRootValue : undefined);
      if (fieldResult == ${asString ? dyk`"null"` : dyk`null`}) {
        throw nonNullError(${locationDetails}, mutablePath.slice(1));
      }
      ${setTargetOrReturn} fieldResult;`;
  } else {
    // Need to catch error and set null
    return dyk`
      try {
        const fieldResult = ${childBucket} == null ? ${
      asString ? dyk`"null"` : dyk`null`
    } : ${childOutputPlan}.${
      asString ? dyk`executeString` : dyk`execute`
    }(root, mutablePath, ${childBucket}, ${childBucketIndex}, ${childBucket}.rootStep === this.rootStep ? rawBucketRootValue : undefined);
        ${setTargetOrReturn} fieldResult;
      } catch (e) {
        const error = coerceError(e, ${locationDetails}, mutablePath.slice(1));
        const pathLengthTarget = mutablePathIndex + 1;
        const overSize = mutablePath.length - pathLengthTarget;
        if (overSize > 0) {
          mutablePath.splice(pathLengthTarget, overSize);
        }
        root.errors.push(error);
        ${setTargetOrReturn} ${asString ? dyk`"null"` : dyk`null`};
      }`;
  }
}

/*
 * Below here we create the executors that can be shared across many different
 * OutputPlans without having to be recreated (thus saving significant memory,
 * and increasing the probability of optimization).
 */

const nullExecutor = makeExecutor(dyk`  return null;`, dyk`null`, false);
const nullExecutorString = makeExecutor(dyk`  return "null";`, dyk`null`, true);

/* This is what leafExecutor should use if insideGraphQL (which isn't currently
 * supported)
`\
  if (root.insideGraphQL) {
    // Don't serialize to avoid the double serialization problem
    return bucketRootValue;
  } else {
    return this.type.serialize(bucketRootValue);
  }
` */
const leafExecutor = makeExecutor(
  dyk`\
  return this.type.serialize(bucketRootValue);
`,
  dyk`leaf`,
  false,
);

const leafExecutorString = makeExecutor(
  dyk`\
  return ${dyk.ref(toJSON)}(this.type.serialize(bucketRootValue));
`,
  dyk`leaf`,
  true,
);

const booleanLeafExecutorString = makeExecutor(
  dyk`\
  const val = this.type.serialize(bucketRootValue);
  return val === true ? 'true' : 'false';
`,
  dyk`booleanLeaf`,
  true,
  EMPTY_OBJECT,
  false,
  dyk`\
  if (bucketRootValue === true) return 'true';
  if (bucketRootValue === false) return 'false';
`,
);

const intLeafExecutorString = makeExecutor(
  dyk`\
  return '' + this.type.serialize(bucketRootValue);
`,
  dyk`intLeaf`,
  true,
  EMPTY_OBJECT,
  false,
  // Fast check to see if number is 32 bit integer
  dyk`\
  if ((bucketRootValue | 0) === bucketRootValue) {
    return '' + bucketRootValue;
  }
`,
);

const floatLeafExecutorString = makeExecutor(
  dyk`\
  return String(this.type.serialize(bucketRootValue));
`,
  dyk`floatLeaf`,
  true,
  EMPTY_OBJECT,
  false,
  dyk`\
  if (Number.isFinite(bucketRootValue)) {
    return '' + bucketRootValue;
  }
`,
);

const stringLeafExecutorString = makeExecutor(
  dyk`\
  return stringifyString(this.type.serialize(bucketRootValue));
`,
  dyk`stringLeaf`,
  true,
  { stringifyString },
  false,
  dyk`\
  if (typeof bucketRootValue === 'string') {
    return stringifyString(bucketRootValue);
  }
`,
);

function makePolymorphicExecutor<TAsString extends boolean>(
  asString: TAsString,
) {
  return makeExecutor(
    dyk`\
${
  isDev
    ? dyk`\
  if (!isPolymorphicData(bucketRootValue)) {
    throw coerceError(
      new Error(
        "GraphileInternalError<db7fcda5-dc39-4568-a7ce-ee8acb88806b>: Expected polymorphic data",
      ),
      this.locationDetails,
      mutablePath.slice(1),
    );
  }
`
    : dyk``
}\
  const typeName = bucketRootValue[$$concreteType];
  const childOutputPlan = this.childByTypeName[typeName];
  ${
    isDev
      ? dyk`{
    assert.ok(
      typeName,
      "GraphileInternalError<fd3f3cf0-0789-4c74-a6cd-839c808896ed>: Could not determine concreteType for object",
    );
    assert.ok(
      childOutputPlan,
      \`GraphileInternalError<a46999ef-41ff-4a22-bae9-fa37ff6e5f7f>: Could not determine the OutputPlan to use for '\${typeName}' from '\${bucket.layerPlan}'\`,
    );
  }`
      : dyk``
  }

  const directChild = bucket.children[childOutputPlan.layerPlan.id];
  if (directChild) {
    return childOutputPlan.${
      asString ? dyk`executeString` : dyk`execute`
    }(root, mutablePath, directChild.bucket, directChild.map.get(bucketIndex));
  } else {
    const c = getChildBucketAndIndex(
      childOutputPlan,
      this,
      bucket,
      bucketIndex,
    );
    if (!c) {
      throw new Error("GraphileInternalError<691509d8-31fa-4cfe-a6df-dcba21bd521f>: polymorphic executor couldn't determine child bucket");
    }
    const [childBucket, childBucketIndex] = c;
    return childOutputPlan.${
      asString ? dyk`executeString` : dyk`execute`
    }(root, mutablePath, childBucket, childBucketIndex);
  }
`,
    dyk`polymorphic`,
    asString,
    {
      isPolymorphicData,
      coerceError,
      assert,
      $$concreteType,
      getChildBucketAndIndex,
    },
  );
}

const polymorphicExecutor = makePolymorphicExecutor(false);
const polymorphicExecutorString = makePolymorphicExecutor(true);

function makeArrayExecutor<TAsString extends boolean>(
  childIsNonNull: boolean,
  canStream: boolean,
  asString: TAsString,
) {
  return makeExecutor(
    dyk`\
  if (!Array.isArray(bucketRootValue)) {
    console.warn(\`Hit fallback for value \${inspect(bucketRootValue)} coercion to mode 'array'\`);
    return ${asString ? dyk`"null"` : dyk`null`};
  }

  const childOutputPlan = this.child;
  const l = bucketRootValue.length;
  ${asString ? dyk`let string;` : dyk`const data = [];`}
  if (l === 0) {
${asString ? dyk`    string = "[]";` : dyk`    /* noop */`}
  } else {
${asString ? dyk`    string = "[";\n` : dyk.blank}\
    const mutablePathIndex = mutablePath.push(-1) - 1;

    // Now to populate the children...
    const directChild = bucket.children[childOutputPlan.layerPlan.id];
    let childBucket, childBucketIndex, lookup;
    if (directChild) {
      childBucket = directChild.bucket;
      lookup = directChild.map.get(bucketIndex)
    }
    for (let i = 0; i < l; i++) {
      if (directChild) {
        childBucketIndex = lookup[i];
      } else {
        const c = getChildBucketAndIndex(
          childOutputPlan,
          this,
          bucket,
          bucketIndex,
          i,
        );
        if (c) {
          ([childBucket, childBucketIndex] = c);
        } else {
          childBucket = childBucketIndex = null;
        }
      }

      mutablePath[mutablePathIndex] = i;
${asString ? dyk`\n      if (i > 0) { string += ","; }` : dyk.blank}
${makeExecuteChildPlanCode(
  asString ? dyk`string +=` : dyk`data[i] =`,
  dyk`this.locationDetails`,
  dyk`childOutputPlan`,
  childIsNonNull,
  asString,
)}
    }

    mutablePath.pop();
${asString ? dyk`    string += "]";\n` : dyk.blank}
  }
${
  canStream
    ? dyk`\
  const stream = bucketRootValue[$$streamMore] /* as | AsyncIterableIterator<any> | undefined*/;
  if (stream) {
    root.streams.push({
      root,
      path: mutablePath.slice(1),
      bucket,
      bucketIndex,
      outputPlan: childOutputPlan,
      label: childOutputPlan.layerPlan.reason.stream?.label,
      stream,
      startIndex: bucketRootValue.length,
    });
  }`
    : dyk``
}

  return ${asString ? dyk`string` : dyk`data`};
`,
    dyk`array${childIsNonNull ? dyk`_nonNull` : dyk.blank}${
      canStream ? dyk`_stream` : dyk.blank
    }`,
    asString,
    {
      inspect,
      getChildBucketAndIndex,
      assert,
      $$streamMore,
    },
  );
}
const arrayExecutor_nullable = makeArrayExecutor(false, false, false);
const arrayExecutor_nullable_streaming = makeArrayExecutor(false, true, false);
const arrayExecutor_nonNullable = makeArrayExecutor(true, false, false);
const arrayExecutor_nonNullable_streaming = makeArrayExecutor(
  true,
  true,
  false,
);
const arrayExecutorString_nullable = makeArrayExecutor(false, false, true);
const arrayExecutorString_nullable_streaming = makeArrayExecutor(
  false,
  true,
  true,
);
const arrayExecutorString_nonNullable = makeArrayExecutor(true, false, true);
const arrayExecutorString_nonNullable_streaming = makeArrayExecutor(
  true,
  true,
  true,
);

const introspect = (
  root: PayloadRoot,
  outputPlan: OutputPlan<OutputPlanTypeIntrospection>,
  mutablePath: ReadonlyArray<string | number>,
  asString: boolean,
) => {
  const { locationDetails } = outputPlan;
  const {
    field: rawField,
    introspectionCacheByVariableValues,
    variableNames,
  } = outputPlan.type as OutputPlanTypeIntrospection;
  const field: FieldNode = {
    ...rawField,
    alias: { kind: Kind.NAME, value: "a" },
  };
  const document: DocumentNode = {
    definitions: [
      {
        kind: Kind.OPERATION_DEFINITION,
        operation: OperationTypeNode.QUERY,
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: [field],
        },
      },
      ...Object.values(outputPlan.layerPlan.operationPlan.fragments),
    ],

    kind: Kind.DOCUMENT,
  };
  const variableValues: Record<string, any> = {};
  for (const variableName of variableNames) {
    variableValues[variableName] = root.variables[variableName];
  }
  // TODO: make this canonical
  const canonical = JSON.stringify(variableValues);
  const cached = introspectionCacheByVariableValues.get(canonical);
  if (cached) {
    return asString ? JSON.stringify(cached) : cached;
  }
  const graphqlResult = executeSync({
    schema: outputPlan.layerPlan.operationPlan.schema,
    document,
    variableValues,
  });
  if (graphqlResult.errors) {
    // TODO: we should map the introspection path
    console.error("INTROSPECTION FAILED!");
    console.error(graphqlResult);
    const { node } = locationDetails;
    throw new GraphQLError(
      "INTROSPECTION FAILED!",
      node,
      null,
      null,
      mutablePath.slice(1),
      null,
      null,
    );
  }
  const result = graphqlResult.data!.a as JSONValue;
  introspectionCacheByVariableValues.set(canonical, result);
  return asString ? JSON.stringify(result) : result;
};

const introspectionExecutor = makeExecutor(
  dyk`  return introspect(root, this, mutablePath, false)`,
  dyk`introspection`,
  false,
  { introspect },
  true,
);
const introspectionExecutorString = makeExecutor(
  dyk`  return introspect(root, this, mutablePath, true)`,
  dyk`introspection`,
  true,
  { introspect },
  true,
);

function makeObjectExecutor<TAsString extends boolean>(
  typeName: string,
  fieldTypes: {
    [key: string]: {
      fieldType: "__typename" | "outputPlan!" | "outputPlan?";
      sameBucket: boolean;
    };
  },
  hasDeferredOutputPlans: boolean,
  // this.type.mode === "root",
  isRoot: boolean,
  asString: TAsString,
): TAsString extends true
  ? typeof OutputPlan.prototype.executeString
  : typeof OutputPlan.prototype.execute {
  // TODO: figure out how to memoize this (without introducing memory leaks)

  const keys = Object.keys(fieldTypes);
  /*
   * NOTE: because we use `Object.create(verbatimPrototype)` (and
   * `verbatimPrototype` is based on Object.create(null)) it's safe for us to
   * set keys such as `__proto__`. This would not be safe if we were to use
   * `{}` instead.
   */
  const unsafeKeys = keys.filter(
    (key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
  );
  if (unsafeKeys.length > 0) {
    throw new Error(
      `Unsafe keys: ${unsafeKeys.join(
        ",",
      )}; these don't conform to 'Name' in the GraphQL spec`,
    );
  }

  const inner = dyk`\
  ${asString ? dyk`let string = "{";` : dyk`const obj = Object.create(null);`}
  const { keys } = this;
  const { children } = bucket;
  const mutablePathIndex = mutablePath.push("SOMETHING_WENT_WRONG_WITH_MUTABLE_PATH") - 1;

${dyk.join(
  Object.entries(fieldTypes).map(
    ([fieldName, { fieldType, sameBucket }], i) => {
      switch (fieldType) {
        case "__typename": {
          if (asString) {
            // NOTE: this code relies on the fact that fieldName and typeName do
            // not require any quoting in JSON/JS - they must conform to GraphQL
            // `Name`.
            return dyk`    string += \`${
              i === 0 ? dyk.blank : dyk`,`
            }"${dyk.substring(fieldName, "`")}":"\${typeName}"\`;`;
          } else {
            return dyk`    obj${dyk.set(fieldName, true)} = typeName;`;
          }
        }
        case "outputPlan!":
        case "outputPlan?": {
          return dyk`\
    {
      mutablePath[mutablePathIndex] = ${dyk.lit(fieldName)};
      const spec = keys${dyk.get(fieldName)};
${
  sameBucket
    ? dyk`\
${makeExecuteChildPlanCode(
  asString
    ? dyk`string += \`${i === 0 ? dyk.blank : dyk`,`}"${dyk.substring(
        fieldName,
        "`",
      )}":\` +`
    : dyk`obj${dyk.set(fieldName, true)} =`,
  dyk`spec.locationDetails`,
  dyk`spec.outputPlan`,
  fieldType === "outputPlan!",
  asString,
  dyk`bucket`,
  dyk`bucketIndex`,
)}`
    : dyk`\
      let childBucket, childBucketIndex;
      const directChild = children[spec.outputPlan.layerPlanId];
      if (directChild) {
        childBucket = directChild.bucket;
        childBucketIndex = directChild.map.get(bucketIndex);
      } else {
        const c = getChildBucketAndIndex(
          spec.outputPlan,
          this,
          bucket,
          bucketIndex,
        );
        if (c) {
          ([childBucket, childBucketIndex] = c);
        } else {
          childBucket = childBucketIndex = null;
        }
      }
${makeExecuteChildPlanCode(
  asString
    ? dyk`string += \`${i === 0 ? dyk.blank : dyk`,`}"${dyk.substring(
        fieldName,
        "`",
      )}":\` +`
    : dyk`obj${dyk.set(fieldName, true)} =`,
  dyk`spec.locationDetails`,
  dyk`spec.outputPlan`,
  fieldType === "outputPlan!",
  asString,
)}`
}
    }`;
        }
        default: {
          const never: never = fieldType;
          throw new Error(
            `GraphileInternalError<879082f4-fe6f-4112-814f-852b9932ca83>: unsupported key type ${never}`,
          );
        }
      }
    },
  ),
  "\n",
)}

  mutablePath.pop();
${asString ? dyk`  string += "}";\n` : dyk.blank}\
${
  hasDeferredOutputPlans
    ? dyk`
  // Everything seems okay; queue any deferred payloads
  for (const defer of this.deferredOutputPlans) {
    root.queue.push({
      root,
      path: mutablePath.slice(1),
      bucket,
      bucketIndex,
      outputPlan: defer,
      label: defer.type.deferLabel,
    });
  }
`
    : dyk``
}
  return ${asString ? dyk`string` : dyk`obj`};`;

  // TODO: figure out how to memoize this. Should be able to key it on:
  // - key name and type: `Object.entries(this.keys).map(([n, v]) => n.name + "|" + n.type)`
  // - existence of deferredOutputPlans
  return makeExecutor(
    inner,
    dyk`object`,
    asString,
    {
      typeName: typeName,
      coerceError: coerceError,
      getChildBucketAndIndex,
    },
    isRoot,
  );
}
