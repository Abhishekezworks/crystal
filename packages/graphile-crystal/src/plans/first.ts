import type { CrystalResultsList, CrystalValuesList } from "../interfaces";
import { ExecutablePlan } from "../plan";

export class FirstPlan<TData> extends ExecutablePlan<TData> {
  static $$export = {
    moduleName: "graphile-crystal",
    exportName: "FirstPlan",
  };

  constructor(parentPlan: ExecutablePlan<ReadonlyArray<TData>>) {
    super();
    this.addDependency(parentPlan);
  }

  execute(
    values: CrystalValuesList<[ReadonlyArray<TData>]>,
  ): CrystalResultsList<TData> {
    return values.map((tuple) => tuple[0]?.[0]);
  }

  deduplicate(peers: FirstPlan<TData>[]): FirstPlan<TData> {
    return peers.length > 0 ? peers[0] : this;
  }
}

/**
 * A plan that resolves to the first entry in the list returned by the given
 * plan.
 */
export function first<TPlan extends ExecutablePlan<ReadonlyArray<any>>>(
  plan: TPlan,
): FirstPlan<TPlan extends ExecutablePlan<ReadonlyArray<infer U>> ? U : never> {
  return new FirstPlan(plan);
}
