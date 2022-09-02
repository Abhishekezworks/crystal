update "c"."person" as __person__ set "person_full_name" = $1::"varchar", "aliases" = $2::"text"[], "about" = $3::"text", "email" = $4::"b"."email", "site" = $5::"b"."wrapped_url" where (__person__."id" = $6::"int4") returning
  __person__."id"::text as "0",
  __person__."person_full_name" as "1",
  __person__."aliases"::text as "2",
  __person__."about" as "3",
  __person__."email" as "4",
  __person__."site"::text as "5"


select __frmcdc_wrapped_url_1_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"b"."wrapped_url" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __frmcdc_wrapped_url_1_identifiers__,
lateral (
  select
    __frmcdc_wrapped_url_1__."url" as "0",
    __frmcdc_wrapped_url_1_identifiers__.idx as "1"
  from (select (__frmcdc_wrapped_url_1_identifiers__."id0").*) as __frmcdc_wrapped_url_1__
) as __frmcdc_wrapped_url_1_result__