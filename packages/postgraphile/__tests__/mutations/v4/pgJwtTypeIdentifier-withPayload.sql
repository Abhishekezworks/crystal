select __authenticate_payload_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0",
    (ids.value->>1)::"numeric" as "id1",
    (ids.value->>2)::"int8" as "id2"
  from json_array_elements($1::json) with ordinality as ids
) as __authenticate_payload_identifiers__,
lateral (
  select
    __authenticate_payload__."jwt"::text as "0",
    __authenticate_payload__."admin"::text as "1",
    __authenticate_payload__."id"::text as "2",
    (not (__authenticate_payload__ is null))::text as "3",
    __authenticate_payload_identifiers__.idx as "4"
  from "b"."authenticate_payload"(
    __authenticate_payload_identifiers__."id0",
    __authenticate_payload_identifiers__."id1",
    __authenticate_payload_identifiers__."id2"
  ) as __authenticate_payload__
) as __authenticate_payload_result__

select __frmcdc_jwt_token_1_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"b"."jwt_token" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __frmcdc_jwt_token_1_identifiers__,
lateral (
  select
    __frmcdc_jwt_token_1__::text as "0",
    (not (__frmcdc_jwt_token_1__ is null))::text as "1",
    __frmcdc_jwt_token_1_identifiers__.idx as "2"
  from (select (__frmcdc_jwt_token_1_identifiers__."id0").*) as __frmcdc_jwt_token_1__
) as __frmcdc_jwt_token_1_result__

select __person_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __person_identifiers__,
lateral (
  select
    __person__."id"::text as "0",
    __person__."person_full_name" as "1",
    __person_identifiers__.idx as "2"
  from "c"."person" as __person__
  where (
    __person__."id" = __person_identifiers__."id0"
  )
  order by __person__."id" asc
) as __person_result__