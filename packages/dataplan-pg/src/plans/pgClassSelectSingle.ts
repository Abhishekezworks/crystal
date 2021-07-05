import type { CrystalResultsList, CrystalValuesList } from "graphile-crystal";
import { ExecutablePlan } from "graphile-crystal";
import sql from "pg-sql2";

import type { PgDataSource } from "../datasource";
import { $$CURSOR } from "../symbols";
import { PgAttributeSelectPlan } from "./pgAttributeSelect";
import { PgClassSelectPlan } from "./pgClassSelect";
import { pgExpression, PgExpressionPlan } from "./pgExpression";
// import debugFactory from "debug";

// const debugPlan = debugFactory("datasource:pg:PgClassSelectSinglePlan:plan");
// const debugExecute = debugFactory("datasource:pg:PgClassSelectSinglePlan:execute");
// const debugPlanVerbose = debugPlan.extend("verbose");
// const debugExecuteVerbose = debugExecute.extend("verbose");

/**
 * Represents the single result of a unique PgClassSelectPlan. This might be
 * retrieved explicitly by PgClassSelectPlan.single(), or implicitly (via
 * Graphile Crystal) by PgClassSelectPlan.item(). Since this is the result of a
 * fetch it does not make sense to support changing `.where` or similar;
 * however we now add methods such as `.get` and `.cursor` which can receive
 * specific properties by telling the PgClassSelectPlan to select the relevant
 * expressions.
 */
export class PgClassSelectSinglePlan<
  TDataSource extends PgDataSource<any, any>,
> extends ExecutablePlan<TDataSource["TRow"]> {
  public readonly itemPlanId: number;

  // TODO: should we move this back to PgClassSelectPlan to help avoid
  // duplicate plans?
  /**
   * We only want to fetch each column once (since columns don't accept any
   * parameters), so this memo keeps track of which columns we've selected so
   * their plans can be easily reused.
   */
  private colPlans: {
    [key in keyof TDataSource["TRow"]]?: number;
  };

  /**
   * If a cursor was requested, what plan returns it?
   */
  private cursorPlanId: number | null;

  private classPlanId: number;
  public readonly dataSource: TDataSource;

  constructor(
    classPlan: PgClassSelectPlan<TDataSource>,
    itemPlan: ExecutablePlan<TDataSource["TRow"]>,
  ) {
    super();
    this.dataSource = classPlan.dataSource;
    this.classPlanId = classPlan.id;
    this.itemPlanId = this.addDependency(itemPlan);
    this.colPlans = {}; // TODO: think about cloning
    this.cursorPlanId = null;
  }

  public toStringMeta(): string {
    return this.dataSource.name;
  }

  public getClassPlan(): PgClassSelectPlan<TDataSource> {
    const plan = this.aether.plans[this.classPlanId];
    if (!(plan instanceof PgClassSelectPlan)) {
      throw new Error(
        `Expected ${this.classPlanId} (${plan}) to be a PgClassSelectPlan`,
      );
    }
    return plan;
  }

  /**
   * Returns a plan representing a named attribute (e.g. column) from the class
   * (e.g. table).
   */
  get<TAttr extends keyof TDataSource["TRow"]>(
    attr: TAttr,
  ): PgExpressionPlan<TDataSource, TDataSource["columns"][TAttr]["codec"]> {
    // Only one plan per column
    const planId: number | undefined = this.colPlans[attr];
    if (planId == null) {
      const classPlan = this.getClassPlan();
      // TODO: where do we do the SQL conversion, e.g. to_json for dates to
      // enforce ISO8601? Perhaps this should be the datasource itself, and
      // `attr` should be an SQL expression? This would allow for computed
      // fields/etc too (admittedly those without arguments).
      const dataSourceColumn = this.dataSource.columns[attr];
      if (!dataSourceColumn) {
        throw new Error(
          `${this.dataSource} does not define an attribute named '${attr}'`,
        );
      }

      /*
       * Only cast to `::text` during select; we want to use it uncasted in
       * conditions/etc. The reasons we cast to ::text include:
       *
       * - to make return values consistent whether they're direct or in nested
       *   arrays
       * - to make sure that that various PostgreSQL clients we support do not
       *   mangle the data in unexpected ways - we take responsibility for
       *   decoding these string values.
       */

      const sqlExpr = pgExpression(this, this.dataSource.columns[attr].codec);
      const colPlan = dataSourceColumn.expression
        ? sqlExpr`${sql.parens(dataSourceColumn.expression(classPlan.alias))}`
        : sqlExpr`${sql.identifier(classPlan.symbol, String(attr))}`;

      this.colPlans[attr] = colPlan.id;
      return colPlan;
    } else {
      const plan = this.aether.plans[planId];
      if (!(plan instanceof PgExpressionPlan)) {
        throw new Error(`Expected ${plan} to be a PgExpressionPlan`);
      }
      return plan;
    }
  }

  /**
   * When selecting a connection we need to be able to get the cursor. The
   * cursor is built from the values of the `ORDER BY` clause so that we can
   * find nodes before/after it.
   */
  public cursor(): PgAttributeSelectPlan<TDataSource> {
    if (this.cursorPlanId == null) {
      const cursorPlan = new PgAttributeSelectPlan(this, $$CURSOR);
      this.cursorPlanId = cursorPlan.id;
      return cursorPlan;
    }
    const plan = this.aether.plans[this.cursorPlanId];
    if (!(plan instanceof PgAttributeSelectPlan)) {
      throw new Error(`Expected ${plan} to be a PgAttributeSelectPlan`);
    }
    return plan;
  }

  execute(
    values: CrystalValuesList<[TDataSource["TRow"]]>,
  ): CrystalResultsList<TDataSource["TRow"]> {
    return values.map((value) => value[this.itemPlanId]);
  }
}
