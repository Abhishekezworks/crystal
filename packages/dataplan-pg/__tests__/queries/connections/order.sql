select
  __author__.username::text as "0",
  __messages__.body::text as "1",
  __messages__."id"::text as "2",
  __messages__."body"::text as "3",
  __users__."username"::text as "4",
  __users__."gravatar_url"::text as "5"
from app_public.messages as __messages__
left outer join app_public.users as __author__
on (__messages__."author_id" = __author__."id")
left outer join app_public.users as __users__
on (__messages__."author_id"::"uuid" = __users__."id")
where
  (
    __messages__.archived_at is null
  ) and (
    true /* authorization checks */
  )
order by __author__.username desc, __messages__.body asc, __messages__."id" asc
limit 5

select
  (count(*))::text as "0"
from app_public.messages as __messages__
left outer join app_public.users as __author__
on (__messages__."author_id" = __author__."id")
where
  (
    __messages__.archived_at is null
  ) and (
    true /* authorization checks */
  )
