select
  (select json_agg(_) from (
    select
      __log_entries__."text" as "0",
      __log_entries__."id"::text as "1"
    from "polymorphic"."log_entries" as __log_entries__
    where (
      __people__."person_id"::"int4" = __log_entries__."person_id"
    )
    order by __log_entries__."text" desc, __log_entries__."id" asc
    limit 1
  ) _) as "0",
  __people__."person_id"::text as "1",
  __people__."username" as "2"
from "polymorphic"."people" as __people__
order by __people__."person_id" desc
limit 5;