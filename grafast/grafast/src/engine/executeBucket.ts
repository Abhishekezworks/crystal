import { isAsyncIterable, isIterable } from "iterall";

import * as assert from "../assert.js";
import type { Bucket, RequestContext } from "../bucket.js";
import { isDev } from "../dev.js";
import type { GrafastError } from "../error.js";
import { $$error, isGrafastError, newGrafastError } from "../error.js";
import type { ExecutableStep } from "../index.js";
import { __ItemStep, isStreamableStep } from "../index.js";
import { inspect } from "../inspect.js";
import type {
  ExecutionExtra,
  GrafastResultsList,
  GrafastResultStreamList,
  GrafastValuesList,
  PromiseOrDirect,
} from "../interfaces.js";
import { $$concreteType, $$streamMore } from "../interfaces.js";
import { assertPolymorphicData } from "../polymorphic.js";
import { $$noExec } from "../step.js";
import { __ValueStep } from "../steps/__value.js";
import { arrayOfLength, isPromiseLike } from "../utils.js";

// An error that indicates this entry was skipped because it didn't match
// polymorphicPath.
const POLY_SKIPPED = newGrafastError(
  new Error("Polymorphic skipped; you should never see this"),
  null,
);

function noop() {
  /*noop*/
}

/**
 * Takes a list of `results` (shorter than `resultCount`) and an object with
 * errors and indexes; returns a list of length `resultCount` with the results
 * from `results` but with errors injected at the indexes specified in
 * `errors`.
 *
 * ASSERT: `results.length + Object.values(errors).length === resultCount`
 *
 * @internal
 */
function mergeErrorsBackIn(
  results: ReadonlyArray<any>,
  errors: { [index: number]: GrafastError },
  resultCount: number,
): any[] {
  const finalResults: any[] = [];
  let resultIndex = 0;

  for (let i = 0; i < resultCount; i++) {
    const error = errors[i];
    if (error) {
      finalResults[i] = error;
    } else {
      finalResults[i] = results[resultIndex++];
    }
  }
  return finalResults;
}

/** @internal */
export function executeBucket(
  bucket: Bucket,
  requestContext: RequestContext,
): PromiseOrDirect<void> {
  const { metaByMetaKey } = requestContext;
  const startedSteps = new Set();
  const pendingSteps = new Set(bucket.layerPlan.pendingSteps);
  const {
    size,
    store,
    noDepsList,
    layerPlan: { startSteps, children: childLayerPlans },
  } = bucket;

  const l = startSteps.length;

  let sideEffectPlanIdsWithErrors: null | number[] = null;

  // Like a `for(i = 0; i < l; i++)` loop with some `await`s in it, except it does promise
  // handling manually so that it can complete synchronously (no promises) if
  // possible.
  const nextSteps = (i: number): PromiseOrDirect<void> => {
    if (i >= l) {
      return;
    }
    bucket.cascadeEnabled = i === l - 1;
    const steps = startSteps[i];
    let starterPromises: PromiseLike<void>[] | null = null;
    let sideEffectPlanIds: null | number[] = null;
    for (const step of steps) {
      if (step.hasSideEffects) {
        if (sideEffectPlanIds === null) {
          sideEffectPlanIds = [step.id];
        } else {
          sideEffectPlanIds.push(step.id);
        }
      }
      try {
        const r = executeStep(step);
        if (isPromiseLike(r)) {
          if (!starterPromises) {
            starterPromises = [r];
          } else {
            starterPromises.push(r);
          }
        }
      } catch (e) {
        const r = newGrafastError(e, step.id);
        bucket.store.set(step.id, arrayOfLength(bucket.size, r));
        bucket.hasErrors = true;
        reallyCompletedStep(step);
      }
    }
    const handleSideEffectPlanIds = () => {
      if (!sideEffectPlanIdsWithErrors) {
        sideEffectPlanIdsWithErrors = [];
      }
      for (const id of sideEffectPlanIds!) {
        sideEffectPlanIdsWithErrors.push(id);
      }
    };
    if (starterPromises !== null) {
      return Promise.all(starterPromises).then(() => {
        if (bucket.hasErrors && sideEffectPlanIds) {
          handleSideEffectPlanIds();
        }
        return nextSteps(i + 1);
      });
    } else {
      if (bucket.hasErrors && sideEffectPlanIds) {
        handleSideEffectPlanIds();
      }
      return nextSteps(i + 1);
    }
  };

  const promise = nextSteps(0);

  if (isPromiseLike(promise)) {
    return promise.then(executeSamePhaseChildren);
  } else {
    return executeSamePhaseChildren();
  }

  // Function definitions below here

  function reallyCompletedStep(
    finishedStep: ExecutableStep,
  ): void | Promise<void> {
    if (isDev && !startedSteps.delete(finishedStep)) {
      console.error(
        `GraphileInternalError<c3d1276b-df0f-4f88-aabf-15fa0f7d8515>: Double complete of '${finishedStep}' detected; ignoring (but this indicates a bug in Grafast)`,
      );
      // DOUBLE COMPLETE?
      return;
    }
    pendingSteps.delete(finishedStep);
    if (pendingSteps.size === 0) {
      // Finished!
      return;
    }
    if (!bucket.cascadeEnabled) {
      // Must be some side effects yet to run
      return;
    }
    let promises: PromiseLike<void>[] | undefined;
    outerLoop: for (const potentialNextStep of finishedStep.sameLayerDependentPlans) {
      const isPending = pendingSteps.has(potentialNextStep);
      if (!isPending) {
        // We've already ran it, skip
        continue;
      }

      // Check if it's suitable
      const sld = potentialNextStep._sameLayerDependencies;
      for (let i = 0, l = sld.length; i < l; i++) {
        const depId = sld[i];
        if (!store.has(depId)) {
          if (isDev) {
            const dep =
              bucket.layerPlan.operationPlan.dangerouslyGetStep(depId)!;
            assert.strictEqual(
              dep.layerPlan,
              bucket.layerPlan,
              `GraphileInternalError<4ca7f9f9-0a00-415f-b6f7-46858fde17c3>: Waiting on ${dep} but it'll never complete because it's not in this bucket (${bucket.layerPlan.id}); this is most likely a bug in copyPlanIds`,
            );
          }
          continue outerLoop;
        }
      }

      // It's suitable; let's run it
      try {
        const r = executeStep(potentialNextStep);
        if (isPromiseLike(r)) {
          if (promises) {
            promises.push(r);
          } else {
            promises = [r];
          }
        }
      } catch (e) {
        const r = newGrafastError(e, potentialNextStep.id);
        bucket.store.set(potentialNextStep.id, arrayOfLength(bucket.size, r));
        bucket.hasErrors = true;
        reallyCompletedStep(potentialNextStep);
      }
    }
    if (promises) {
      return Promise.all(promises) as Promise<any> as Promise<void>;
    } else {
      return;
    }
  }

  function completedStep(
    finishedStep: ExecutableStep,
    result: GrafastValuesList<any>,
  ): void | Promise<void> {
    if (!Array.isArray(result)) {
      throw new Error(
        `Result from ${finishedStep} should be an array, instead received ${inspect(
          result,
          { colors: true },
        )}`,
      );
    }
    const resultLength = result.length;
    if (resultLength !== size) {
      throw new Error(
        `Result array from ${finishedStep} should have length ${size}, instead it had length ${result.length}`,
      );
    }
    // Need to complete promises, check for errors, etc.
    // **DO NOT THROW, DO NOT ALLOW AN ERROR TO BE RAISED!**
    // **USE DEFENSIVE PROGRAMMING HERE!**

    const finalResult: any[] = [];
    let promises: PromiseLike<void>[] | undefined;
    let pendingPromises: PromiseLike<any>[] | undefined;
    let pendingPromiseIndexes: number[] | undefined;
    const success = (value: unknown, resultIndex: number) => {
      let proto: any;
      if (
        // Fast-lane for non-objects and simple objects
        typeof value !== "object" ||
        value === null ||
        (proto = Object.getPrototypeOf(value)) === null ||
        proto === Object.prototype
      ) {
        finalResult[resultIndex] = value;
      } else if (value instanceof Error) {
        const e = value[$$error]
          ? value
          : newGrafastError(value, finishedStep.id);
        finalResult[resultIndex] = e;
        bucket.hasErrors = true;
      } else if (
        // Detects async iterables (but excludes all the basic types
        // like arrays, Maps, Sets, etc that are also iterables) and
        // handles them specially.
        isAsyncIterable(value) &&
        !isIterable(value)
      ) {
        const iterator = value[Symbol.asyncIterator]();

        const streamOptions = finishedStep._stepOptions.stream;
        const initialCount: number = streamOptions
          ? streamOptions.initialCount
          : Infinity;

        // TODO:critical: need to ensure that iterator is terminated
        // even if the stream is never consumed (e.g. if something else
        // errors). For query/mutation we can do this when operation
        // completes, for subscription we should do it after each
        // individual payload (and all its streamed/deferred children)
        // are complete before processing the next subscription event.

        if (initialCount === 0) {
          // Optimization - defer everything
          const arr: any[] = [];
          arr[$$streamMore] = iterator;
          finalResult[resultIndex] = arr;
        } else {
          // Evaluate the first initialCount entries, rest is streamed.
          const promise = (async () => {
            try {
              let valuesSeen = 0;
              const arr: any[] = [];

              /*
               * We need to "shift" a few entries off the top of the
               * iterator, but still keep it iterable for the later
               * stream. To accomplish this we have to do manual
               * looping
               */

              let resultPromise: Promise<IteratorResult<any, any>>;
              while ((resultPromise = iterator.next())) {
                const finalResult = await resultPromise;
                if (finalResult.done) {
                  break;
                }
                arr.push(await finalResult.value);
                if (++valuesSeen >= initialCount) {
                  // This is safe to do in the `while` since we checked
                  // the `0` entries condition in the optimization
                  // above.
                  arr[$$streamMore] = iterator;
                  break;
                }
              }

              finalResult[resultIndex] = arr;
            } catch (e) {
              bucket.hasErrors = true;
              finalResult[resultIndex] = newGrafastError(e, finishedStep.id);
            }
          })();
          if (!promises) {
            promises = [promise];
          } else {
            promises.push(promise);
          }
        }
      } else {
        finalResult[resultIndex] = value;
      }
    };

    // If there are no promises, we want to do the sync route.
    for (let i = 0; i < resultLength; i++) {
      const val = result[i];
      if (isPromiseLike(val)) {
        if (!pendingPromises) {
          pendingPromises = [val];
          pendingPromiseIndexes = [i];
        } else {
          pendingPromises.push(val);
          pendingPromiseIndexes!.push(i);
        }
      } else {
        success(val, i);
      }
    }

    const done = () => {
      if (promises) {
        // This _should not_ throw.
        return Promise.all(promises).then(() => {
          store.set(finishedStep.id, finalResult);
          return reallyCompletedStep(finishedStep);
        });
      } else {
        store.set(finishedStep.id, finalResult);
        return reallyCompletedStep(finishedStep);
      }
    };

    if (pendingPromises) {
      return Promise.allSettled(pendingPromises)
        .then((resultSettledResult) => {
          // Deliberate shadowing
          for (
            let i = 0, pendingPromisesLength = resultSettledResult.length;
            i < pendingPromisesLength;
            i++
          ) {
            const settledResult = resultSettledResult[i];
            const resultIndex = pendingPromiseIndexes![i];
            if (settledResult.status === "fulfilled") {
              success(settledResult.value, resultIndex);
            } else {
              bucket.hasErrors = true;
              finalResult[resultIndex] = newGrafastError(
                settledResult.reason,
                finishedStep.id,
              );
            }
          }
          return done();
        })
        .then(null, (e) => {
          // THIS SHOULD NEVER HAPPEN!
          console.error(
            `GraphileInternalError<1e9731b4-005e-4b0e-bc61-43baa62e6444>: error occurred whilst performing completedStep(${finishedStep.id})`,
          );
          const grafastError = newGrafastError(
            new Error(
              `GraphileInternalError<1e9731b4-005e-4b0e-bc61-43baa62e6444>: error occurred whilst performing completedStep(${finishedStep.id})`,
            ),
            finishedStep.id,
          );
          console.error(`${grafastError.originalError}\n  ${e}`);
          store.set(
            finishedStep.id,
            arrayOfLength(finalResult.length, grafastError),
          );
          return reallyCompletedStep(finishedStep);
        });
    } else {
      return done();
    }
  }

  function executeOrStream(
    step: ExecutableStep,
    dependencies: ReadonlyArray<any>[],
    extra: ExecutionExtra,
  ): PromiseOrDirect<GrafastResultsList<any> | GrafastResultStreamList<any>> {
    if (step._stepOptions.stream && isStreamableStep(step)) {
      return step.stream(dependencies, extra, step._stepOptions.stream);
    } else {
      return step.execute(dependencies, extra);
    }
  }

  // Slow mode...
  /**
   * Execute the step, filtering out errors and entries with non-matching
   * polymorphicPaths from the input dependencies and then padding the lists
   * back out at the end.
   */
  function reallyExecuteStepWithErrorsOrSelective(
    step: ExecutableStep,
    dependenciesIncludingSideEffects: ReadonlyArray<any>[],
    polymorphicPathList: readonly string[],
    extra: ExecutionExtra,
  ): PromiseOrDirect<GrafastResultsList<any> | GrafastResultStreamList<any>> {
    const errors: { [index: number]: GrafastError } = Object.create(null);

    /** If there's errors, we must manipulate the arrays being passed into the step execution */
    let foundErrors = false;

    /** If all we see is errors, there's no need to execute! */
    let needsNoExecution = true;

    for (let index = 0, l = polymorphicPathList.length; index < l; index++) {
      const polymorphicPath = polymorphicPathList[index];
      if (!step.polymorphicPaths.has(polymorphicPath)) {
        foundErrors = true;
        const e = isDev
          ? newGrafastError(
              new Error(
                `GraphileInternalError<00d52055-06b0-4b25-abeb-311b800ea284>: ${step} (polymorphicPaths ${[
                  ...step.polymorphicPaths,
                ]}) has no match for '${polymorphicPath}'`,
              ),
              step.id,
            )
          : POLY_SKIPPED;

        errors[index] = e;
      } else if (extra._bucket.hasErrors) {
        let noError = true;
        for (const depList of dependenciesIncludingSideEffects) {
          const v = depList[index];
          if (isGrafastError(v)) {
            if (!errors[index]) {
              noError = false;
              foundErrors = true;
              errors[index] = v;
              break;
            }
          }
        }
        if (noError) {
          needsNoExecution = false;
        }
      } else {
        needsNoExecution = false;
      }
    }

    // Trim the side-effect dependencies back out again
    const dependencies = sideEffectPlanIdsWithErrors
      ? dependenciesIncludingSideEffects.slice(
          0,
          // There must always be at least one dependency! This serves the same
          // purpose as bucket.noDepsList
          Math.max(1, step.dependencies.length),
        )
      : dependenciesIncludingSideEffects;

    if (needsNoExecution) {
      // Everything is errors; we can skip execution
      return Object.values(errors);
    } else if (foundErrors) {
      const dependenciesWithoutErrors = dependencies.map((depList) =>
        depList.filter((_, index) => !errors[index]),
      );
      const resultWithoutErrors = executeOrStream(
        step,
        dependenciesWithoutErrors,
        extra,
      );
      if (isPromiseLike(resultWithoutErrors)) {
        return resultWithoutErrors.then((r) =>
          mergeErrorsBackIn(r, errors, dependencies[0].length),
        );
      } else {
        return mergeErrorsBackIn(
          resultWithoutErrors,
          errors,
          dependencies[0].length,
        );
      }
    } else {
      return reallyExecuteStepWithNoErrors(step, dependencies, extra);
    }
  }

  // TODO: if this is what we end up with, remove the indirection.
  /**
   * Execute the step directly; since there's no errors we can pass the
   * dependencies through verbatim!
   */
  function reallyExecuteStepWithNoErrors(
    step: ExecutableStep,
    dependencies: ReadonlyArray<any>[],
    extra: ExecutionExtra,
  ) {
    return executeOrStream(step, dependencies, extra);
  }

  // TODO: this function used to state that it would never throw/reject... but,
  // no code is perfect... so that just seemed like it was asking for
  // trouble. Lets make sure if it throws/rejects that nothing bad will happen.
  /**
   * This function MIGHT throw or reject, so be sure to handle that.
   */
  function executeStep(step: ExecutableStep): void | PromiseLike<void> {
    if (startedSteps.has(step)) {
      return;
    }
    startedSteps.add(step);
    if (isDev && $$noExec in step) {
      throw new Error("OLD PATH!");
      // Bypass execution
      return reallyCompletedStep(step);
    }
    try {
      const meta = metaByMetaKey[step.metaKey];
      const extra: ExecutionExtra = {
        meta,
        eventEmitter: requestContext.eventEmitter,
        _bucket: bucket,
        _requestContext: requestContext,
      };
      const dependencies: ReadonlyArray<any>[] = [];
      const depCount = step.dependencies.length;
      if (depCount > 0 || sideEffectPlanIdsWithErrors !== null) {
        for (let i = 0, l = depCount; i < l; i++) {
          const depId = step.dependencies[i];
          dependencies[i] = store.get(depId)!;
        }
        if (sideEffectPlanIdsWithErrors !== null) {
          for (const sideEffectPlanId of sideEffectPlanIdsWithErrors) {
            const sideEffectStoreEntry = store.get(sideEffectPlanId)!;
            if (!dependencies.includes(sideEffectStoreEntry)) {
              dependencies.push(sideEffectStoreEntry);
            }
          }
        }
      } else {
        dependencies.push(noDepsList);
      }
      const isSelectiveStep =
        step.polymorphicPaths.size !== step.layerPlan.polymorphicPaths.size;
      const result =
        bucket.hasErrors || isSelectiveStep
          ? reallyExecuteStepWithErrorsOrSelective(
              step,
              dependencies,
              bucket.polymorphicPathList,
              extra,
            )
          : reallyExecuteStepWithNoErrors(step, dependencies, extra);
      if (isPromiseLike(result)) {
        return result.then(
          (values) => {
            return completedStep(step, values);
          },
          (error) => {
            bucket.hasErrors = true;
            return completedStep(step, arrayOfLength(size, error));
          },
        );
      } else {
        if (step.isSyncAndSafe) {
          // It promises not to add new errors, and not to include promises in the result array
          store.set(step.id, result as any[]);
          return reallyCompletedStep(step);
        } else {
          return completedStep(step, result);
        }
      }
    } catch (error) {
      bucket.hasErrors = true;
      if (step.isSyncAndSafe) {
        // It promises not to add new errors, and not to include promises in the result array
        const newResult = arrayOfLength(size, newGrafastError(error, step.id));
        store.set(step.id, newResult);
        return reallyCompletedStep(step);
      } else {
        const newResult = arrayOfLength(size, error);
        return completedStep(step, newResult);
      }
    }
  }

  function executeSamePhaseChildren(): PromiseOrDirect<void> {
    if (pendingSteps.size > 0) {
      throw new Error(
        `GraphileInternalError<8c518856-6e96-425e-91ce-0e0713dbdead>: executeSamePhaseChildren called before all steps were complete! Remaining steps were: ${[
          ...pendingSteps,
        ].join(", ")}`,
      );
    }

    // TODO: create a JIT factory for this at planning time
    const childPromises: PromiseLike<any>[] = [];

    // This promise should never reject
    let mutationQueue: PromiseLike<void> | null = null;
    /**
     * Ensures that callback is only called once all other enqueued callbacks
     * are called.
     */
    const enqueue = <T>(callback: () => PromiseOrDirect<T>): PromiseLike<T> => {
      const result = (mutationQueue ?? Promise.resolve()).then(callback);
      mutationQueue = result.then(noop, noop);
      return result;
    };

    loop: for (const childLayerPlan of childLayerPlans) {
      switch (childLayerPlan.reason.type) {
        case "nullableBoundary":
        case "listItem":
        case "polymorphic": {
          const childBucket = childLayerPlan.newBucket(bucket);
          if (childBucket) {
            // Execute
            const result = executeBucket(childBucket, requestContext);
            if (isPromiseLike(result)) {
              childPromises.push(result);
            }
          }
          break;
        }
        case "mutationField": {
          const childBucket = childLayerPlan.newBucket(bucket);
          if (childBucket) {
            // Enqueue for execution (mutations must run in order)
            const promise = enqueue(() =>
              executeBucket(childBucket, requestContext),
            );
            childPromises.push(promise);
          }

          break;
        }
        case "subroutine":
        case "subscription":
        case "defer": {
          // Ignore; these are handled elsewhere
          continue loop;
        }
        case "root": {
          throw new Error(
            // *confused emoji*
            "GraphileInternalError<05fb7069-81b5-43f7-ae71-f62547d2c2b7>: root cannot be not the root (...)",
          );
        }
        default: {
          const never: never = childLayerPlan.reason;
          throw new Error(
            `GraphileInternalError<>: unhandled reason '${inspect(never)}'`,
          );
        }
      }
    }

    if (childPromises.length > 0) {
      return Promise.all(childPromises).then(() => {
        bucket.isComplete = true;
        return;
      });
    } else {
      bucket.isComplete = true;
      return;
    }
  }
}

/** @internal */
export function newBucket(
  spec: Pick<
    Bucket,
    "layerPlan" | "store" | "size" | "hasErrors" | "polymorphicPathList"
  >,
): Bucket {
  if (isDev) {
    // Some validations
    if (!(spec.size > 0)) {
      throw new Error(
        "GraphileInternalError<eb5c962d-c748-4759-95e3-52c50c873593>: No need to create an empty bucket!",
      );
    }
    assert.strictEqual(
      spec.polymorphicPathList.length,
      spec.size,
      "polymorphicPathList length must match bucket size",
    );
    for (let i = 0, l = spec.size; i < l; i++) {
      const p = spec.polymorphicPathList[i];
      assert.strictEqual(
        typeof p,
        "string",
        `Entry ${i} in polymorphicPathList for bucket for ${spec.layerPlan} was not a string`,
      );
    }
    for (const [key, list] of spec.store.entries()) {
      assert.ok(
        Array.isArray(list),
        `Store entry for step '${key}' for layerPlan '${spec.layerPlan.id}' should be a list`,
      );
      assert.strictEqual(
        list.length,
        spec.size,
        `Store entry for step '${key}' for layerPlan '${spec.layerPlan.id}' should have same length as bucket`,
      );
    }
  }
  return {
    // Copy from spec
    layerPlan: spec.layerPlan,
    store: spec.store,
    size: spec.size,
    hasErrors: spec.hasErrors,
    polymorphicPathList: spec.polymorphicPathList,

    isComplete: false,
    cascadeEnabled: false,
    noDepsList: arrayOfLength(spec.size, undefined),
    children: Object.create(null),
  };
}
