import type { SQLQuery } from "../src/index.js";
import sql from "../src/index.js";

it("table.column::text 1", () => {
  const node = sql`${sql.parens(sql.identifier("table", "column"))}::text`;
  expect(sql.compile(node)).toEqual({
    text: '"table"."column"::text',
    values: [],
  });
});

it("table.column::text 2", () => {
  const node = sql`${sql.parens(
    sql`${sql.identifier("table")}.${sql.identifier("column")}`,
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: '"table"."column"::text',
    values: [],
  });
});

it("table.column::text 3", () => {
  const node = sql`${sql.parens(
    sql`${sql.identifier("table")}."column"`,
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: '"table"."column"::text',
    values: [],
  });
});

it("__table__.column::text", () => {
  const node = sql`${sql.parens(
    sql`${sql.identifier(Symbol("table"))}.column`,
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: "__table__.column::text",
    values: [],
  });
});

it("((table.column).attr)::text 1", () => {
  const node = sql`${sql.parens(
    sql`${sql.parens(sql.identifier("table", "column"), true)}.${sql.identifier(
      "attr",
    )}`,
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: '(("table"."column")."attr")::text',
    values: [],
  });
});

it("((table.column).attr)::text 2", () => {
  const node = sql`${sql.parens(
    sql`${sql.parens(
      sql`${sql.identifier("table", "column")}`,
      true,
    )}.${sql.identifier("attr")}`,
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: '(("table"."column")."attr")::text',
    values: [],
  });
});

it("((table.column).attr)::text 3", () => {
  const inner = sql.parens(
    sql`${sql.identifier("table")}.${sql.identifier("column")}`,
    true,
  );
  const node = sql`${sql.parens(
    sql`${inner}.${sql.identifier("attr")}`,
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: '(("table"."column")."attr")::text',
    values: [],
  });
});

it("join(conditions, ' and ') 1", () => {
  const conditions = [
    sql`__messages__.archived_at is null`,
    sql`__messages__."id" > __messages_identifiers__."id0"`,
    sql`true /* authorization checks */`,
  ];
  const node = sql.join(
    conditions.map((c) => sql.parens(sql.indent(c))),
    " and ",
  );
  expect(sql.compile(node)).toEqual({
    text: `\
(
  __messages__.archived_at is null
) and (
  __messages__."id" > __messages_identifiers__."id0"
) and (
  true /* authorization checks */
)`,
    values: [],
  });
});

it("join(conditions, ' and ') 2", () => {
  const conditions = [
    sql`__messages__.archived_at is null`,
    sql.parens(sql`__messages__."id" > __messages_identifiers__."id0"`),
    sql`true /* authorization checks */`,
  ];
  const node = sql.join(
    conditions.map((c) => sql.parens(sql.indent(c))),
    " and ",
  );
  expect(sql.compile(node)).toEqual({
    text: `\
(
  __messages__.archived_at is null
) and (
  __messages__."id" > __messages_identifiers__."id0"
) and (
  true /* authorization checks */
)`,
    values: [],
  });
});

it("join(conditions, ' and ') 3", () => {
  const conditions = [
    sql.parens(sql`__messages__."id" > __messages_identifiers__."id0"`),
  ];
  const node = sql.join(
    conditions.map((c) => sql.parens(sql.indent(c))),
    " and ",
  );
  expect(sql.compile(node)).toEqual({
    text: `\
(
  __messages__."id" > __messages_identifiers__."id0"
)`,
    values: [],
  });
});

it("join(conditions, ' and ') 4", () => {
  const conditions = [
    sql.parens(sql.indent(sql`__person__."id" < __person_identifiers__."id0"`)),
  ];
  const node = sql.join(
    conditions.map((c) => sql.parens(sql.indent(c))),
    " and ",
  );
  expect(sql.compile(node)).toEqual({
    text: `\
(
    __person__."id" < __person_identifiers__."id0"
)`,
    values: [],
  });
});

it("expression column", () => {
  const node = sql`${sql.parens(
    sql.parens(
      sql`${sql.identifier(Symbol("forums"))}.archived_at is not null`,
    ),
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: `(__forums__.archived_at is not null)::text`,
    values: [],
  });
});

it("expression column 2", () => {
  const node = sql`${sql.parens(
    sql`${sql.parens(
      sql`${sql.identifier(Symbol("forums"))}.archived_at is not null`,
    )}`,
  )}::text`;
  expect(sql.compile(node)).toEqual({
    text: `(__forums__.archived_at is not null)::text`,
    values: [],
  });
});
