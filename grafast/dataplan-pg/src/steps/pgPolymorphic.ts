import type {
  ExecutableStep,
  ExecutionExtra,
  PolymorphicData,
  PolymorphicStep,
} from "grafast";
import { isDev, polymorphicWrap, UnbatchedExecutableStep } from "grafast";
import type { GraphQLObjectType } from "graphql";
import { inspect } from "util";

import type { PgClassExpressionStep } from "./pgClassExpression.js";
import type { PgSelectSingleStep } from "./pgSelectSingle.js";

/**
 * A map from the potential concrete types a polymorphic item may be, how to
 * determine which one is correct, and how to handle it if it matches.
 */
export interface PgPolymorphicTypeMap<
  TItemStep extends
    | PgSelectSingleStep<any, any, any, any>
    | PgClassExpressionStep<any, any, any, any, any, any>,
  TTypeSpecifier,
  TTypeSpecifierStep extends ExecutableStep<TTypeSpecifier> = ExecutableStep<TTypeSpecifier>,
> {
  [typeName: string]: {
    match(specifier: TTypeSpecifier): boolean;
    plan($specifier: TTypeSpecifierStep, $item: TItemStep): ExecutableStep<any>;
  };
}

/**
 * This class is used for dealing with polymorphism; you feed it a plan
 * representing an item, a second plan indicating the type of that item, and a
 * PgPolymorphicTypeMap that helps figure out which type the item is and how to
 * handle it.
 */
export class PgPolymorphicStep<
    TItemStep extends
      | PgSelectSingleStep<any, any, any, any>
      | PgClassExpressionStep<any, any, any, any, any, any>,
    TTypeSpecifier,
    TTypeSpecifierStep extends ExecutableStep<TTypeSpecifier> = ExecutableStep<TTypeSpecifier>,
  >
  extends UnbatchedExecutableStep<any>
  implements PolymorphicStep
{
  static $$export = {
    moduleName: "@dataplan/pg",
    exportName: "PgPolymorphicStep",
  };
  isSyncAndSafe = true;

  private typeSpecifierStepId: number;
  private itemStepId: number;
  private types: string[];

  constructor(
    $item: TItemStep,
    $typeSpecifier: TTypeSpecifierStep,
    private possibleTypes: PgPolymorphicTypeMap<
      TItemStep,
      TTypeSpecifier,
      TTypeSpecifierStep
    >,
  ) {
    super();
    this.itemStepId = this.addDependency($item);
    this.typeSpecifierStepId = this.addDependency($typeSpecifier);
    this.types = Object.keys(possibleTypes);
  }

  deduplicate(
    peers: PgPolymorphicStep<any, any, any>[],
  ): PgPolymorphicStep<TItemStep, TTypeSpecifier, TTypeSpecifierStep>[] {
    return peers.filter((peer) => {
      return peer.possibleTypes === this.possibleTypes;
    }) as any;
  }

  itemPlan(): TItemStep {
    const plan = this.getStep(this.dependencies[this.itemStepId]);
    return plan as any;
  }

  typeSpecifierPlan(): TTypeSpecifierStep {
    const plan = this.getStep(
      this.dependencies[this.typeSpecifierStepId],
    ) as TTypeSpecifierStep;
    return plan;
  }

  planForType(type: GraphQLObjectType): ExecutableStep {
    const spec = this.possibleTypes[type.name];
    if (!spec) {
      throw new Error(
        `${this} could resolve to ${
          type.name
        }, but can only handle the following types: '${Object.keys(
          this.possibleTypes,
        ).join("', '")}'`,
      );
    }
    return spec.plan(this.typeSpecifierPlan(), this.itemPlan());
  }

  private getTypeNameFromSpecifier(specifier: TTypeSpecifier) {
    const t = this.types.find((t) => this.possibleTypes[t].match(specifier));
    if (!t) {
      if (isDev) {
        console.error(
          `Could not find a type that matched the specifier '${inspect(
            specifier,
          )}'`,
        );
      }
      throw new Error(
        "Could not determine the type to use for this polymorphic value.",
      );
    }
    return t;
  }

  unbatchedExecute(
    extra: ExecutionExtra,
    item: any,
    specifier: any,
  ): PolymorphicData<string> | null {
    if (specifier) {
      const typeName = this.getTypeNameFromSpecifier(specifier);
      return polymorphicWrap(typeName);
    } else {
      return null;
    }
  }
}

/**
 * This class is used for dealing with polymorphism; you feed it a plan
 * representing an item, a second plan indicating the type of that item, and a
 * PgPolymorphicTypeMap that helps figure out which type the item is and how to
 * handle it.
 */
export function pgPolymorphic<
  TItemStep extends
    | PgSelectSingleStep<any, any, any, any>
    | PgClassExpressionStep<any, any, any, any, any, any>,
  TTypeSpecifier = any,
  TTypeSpecifierStep extends ExecutableStep<TTypeSpecifier> = ExecutableStep<TTypeSpecifier>,
>(
  $item: TItemStep,
  $typeSpecifier: TTypeSpecifierStep,
  possibleTypes: PgPolymorphicTypeMap<
    TItemStep,
    TTypeSpecifier,
    TTypeSpecifierStep
  >,
): PgPolymorphicStep<TItemStep, TTypeSpecifier, TTypeSpecifierStep> {
  return new PgPolymorphicStep<TItemStep, TTypeSpecifier, TTypeSpecifierStep>(
    $item,
    $typeSpecifier,
    possibleTypes,
  );
}

Object.defineProperty(pgPolymorphic, "$$export", {
  value: {
    moduleName: "@dataplan/pg",
    exportName: "pgPolymorphic",
  },
});
