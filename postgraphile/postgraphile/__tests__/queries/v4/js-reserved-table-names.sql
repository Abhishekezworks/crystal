select
  __constructor__."name" as "0",
  __constructor__."export" as "1",
  __constructor__."id"::text as "2"
from "js_reserved"."constructor" as __constructor__
order by __constructor__."id" asc;

select __constructor_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"text" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __constructor_identifiers__,
lateral (
  select
    __constructor__."name" as "0",
    __constructor__."id"::text as "1",
    __constructor_identifiers__.idx as "2"
  from "js_reserved"."constructor" as __constructor__
  where (
    __constructor__."export" = __constructor_identifiers__."id0"
  )
  order by __constructor__."id" asc
) as __constructor_result__;

select __constructor_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __constructor_identifiers__,
lateral (
  select
    __constructor__."export" as "0",
    __constructor__."name" as "1",
    __constructor__."id"::text as "2",
    __constructor_identifiers__.idx as "3"
  from "js_reserved"."constructor" as __constructor__
  where (
    __constructor__."id" = __constructor_identifiers__."id0"
  )
  order by __constructor__."id" asc
) as __constructor_result__;

select __constructor_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"text" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __constructor_identifiers__,
lateral (
  select
    __constructor__."export" as "0",
    __constructor__."id"::text as "1",
    __constructor_identifiers__.idx as "2"
  from "js_reserved"."constructor" as __constructor__
  where (
    __constructor__."name" = __constructor_identifiers__."id0"
  )
  order by __constructor__."id" asc
) as __constructor_result__;

select
  __yield__."crop" as "0",
  __yield__."export" as "1",
  __yield__."id"::text as "2"
from "js_reserved"."yield" as __yield__
order by __yield__."id" asc;

select __yield_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"text" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __yield_identifiers__,
lateral (
  select
    __yield__."crop" as "0",
    __yield__."id"::text as "1",
    __yield_identifiers__.idx as "2"
  from "js_reserved"."yield" as __yield__
  where (
    __yield__."export" = __yield_identifiers__."id0"
  )
  order by __yield__."id" asc
) as __yield_result__;

select __yield_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __yield_identifiers__,
lateral (
  select
    __yield__."crop" as "0",
    __yield__."export" as "1",
    __yield__."id"::text as "2",
    __yield_identifiers__.idx as "3"
  from "js_reserved"."yield" as __yield__
  where (
    __yield__."id" = __yield_identifiers__."id0"
  )
  order by __yield__."id" asc
) as __yield_result__;

select
  __proto__."id"::text as "0",
  __proto__."name" as "1",
  __proto__."brand" as "2"
from "js_reserved"."__proto__" as __proto__
order by __proto__."id" asc;

select __proto_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __proto_identifiers__,
lateral (
  select
    __proto__."brand" as "0",
    __proto__."name" as "1",
    __proto__."id"::text as "2",
    __proto_identifiers__.idx as "3"
  from "js_reserved"."__proto__" as __proto__
  where (
    __proto__."id" = __proto_identifiers__."id0"
  )
  order by __proto__."id" asc
) as __proto_result__;

select __proto_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"text" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __proto_identifiers__,
lateral (
  select
    __proto__."brand" as "0",
    __proto__."id"::text as "1",
    __proto_identifiers__.idx as "2"
  from "js_reserved"."__proto__" as __proto__
  where (
    __proto__."name" = __proto_identifiers__."id0"
  )
  order by __proto__."id" asc
) as __proto_result__;

select
  __null__."break" as "0",
  __null__."hasownproperty" as "1",
  __null__."id"::text as "2"
from "js_reserved"."null" as __null__
order by __null__."id" asc;

select __null_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"text" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __null_identifiers__,
lateral (
  select
    __null__."hasownproperty" as "0",
    __null__."id"::text as "1",
    __null_identifiers__.idx as "2"
  from "js_reserved"."null" as __null__
  where (
    __null__."break" = __null_identifiers__."id0"
  )
  order by __null__."id" asc
) as __null_result__;

select __null_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"text" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __null_identifiers__,
lateral (
  select
    __null__."break" as "0",
    __null__."id"::text as "1",
    __null_identifiers__.idx as "2"
  from "js_reserved"."null" as __null__
  where (
    __null__."hasownproperty" = __null_identifiers__."id0"
  )
  order by __null__."id" asc
) as __null_result__;

select __null_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __null_identifiers__,
lateral (
  select
    __null__."break" as "0",
    __null__."hasownproperty" as "1",
    __null__."id"::text as "2",
    __null_identifiers__.idx as "3"
  from "js_reserved"."null" as __null__
  where (
    __null__."id" = __null_identifiers__."id0"
  )
  order by __null__."id" asc
) as __null_result__;