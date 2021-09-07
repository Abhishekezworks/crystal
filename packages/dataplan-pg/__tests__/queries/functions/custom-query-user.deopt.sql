select
  __random_user__."username"::text as "0",
  __random_user__."gravatar_url"::text as "1"
from app_public.random_user() as __random_user__
where (
  true /* authorization checks */
)
order by __random_user__."id" asc