select
  __people__."username" as "0",
  __people__."person_id"::text as "1"
from "polymorphic"."people" as __people__
order by __people__."person_id" asc
limit 4;

select __union_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0",
    (ids.value->>1)::"int4" as "id1",
    (ids.value->>2)::"text" as "id2",
    (ids.value->>3)::"text" as "id3",
    (ids.value->>4)::"json" as "id4"
  from json_array_elements($1::json) with ordinality as ids
) as __union_identifiers__,
lateral (
  select
    __union__."0" as "0",
    __union__."1"::text as "1",
    __union_identifiers__.idx as "2"
  from (
      select
        __aws_applications__."0",
        __aws_applications__."1",
        "n"
      from (
        select
          'AwsApplication' as "0",
          json_build_array((__aws_applications__."id")::text) as "1",
          row_number() over (
            order by
              __aws_applications__."id" asc
          ) as "n"
        from "polymorphic"."aws_applications" as __aws_applications__
        where __aws_applications__."person_id" = __union_identifiers__."id0"
        and __aws_applications__."name" = __union_identifiers__."id2"
        and (
          ('AwsApplication' > __union_identifiers__."id3")
          or (
            'AwsApplication' = __union_identifiers__."id3"
            and (
              __aws_applications__."id" > (__union_identifiers__."id4"->>0)::"int4"
            )
          )
        )
        order by
          __aws_applications__."id" asc
        limit 1
      ) as __aws_applications__
    union all
      select
        __gcp_applications__."0",
        __gcp_applications__."1",
        "n"
      from (
        select
          'GcpApplication' as "0",
          json_build_array((__gcp_applications__."id")::text) as "1",
          row_number() over (
            order by
              __gcp_applications__."id" asc
          ) as "n"
        from "polymorphic"."gcp_applications" as __gcp_applications__
        where __gcp_applications__."person_id" = __union_identifiers__."id1"
        and __gcp_applications__."name" = __union_identifiers__."id2"
        and (
          ('GcpApplication' > __union_identifiers__."id3")
          or (
            'GcpApplication' = __union_identifiers__."id3"
            and (
              __gcp_applications__."id" > (__union_identifiers__."id4"->>0)::"int4"
            )
          )
        )
        order by
          __gcp_applications__."id" asc
        limit 1
      ) as __gcp_applications__
    order by
      "0" asc,
      "n" asc
    limit 1
  ) __union__
) as __union_result__;

select __aws_applications_result__.*
from (
  select
    ids.ordinality - 1 as idx,
    (ids.value->>0)::"int4" as "id0"
  from json_array_elements($1::json) with ordinality as ids
) as __aws_applications_identifiers__,
lateral (
  select
    __aws_applications__."name" as "0",
    __aws_applications__."id"::text as "1",
    __aws_applications_identifiers__.idx as "2"
  from "polymorphic"."aws_applications" as __aws_applications__
  where (
    __aws_applications__."id" = __aws_applications_identifiers__."id0"
  )
  order by __aws_applications__."id" asc
) as __aws_applications_result__;