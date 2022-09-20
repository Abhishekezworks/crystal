# loadOne

Similar to [DataLoader][]'s load method, uses the given callback function to
read a single result from your business logic layer. To load a list, see
`loadMany`.

Usage:

```ts
const $userId = $post.get("author_id");
const $user = loadOne($userId, getUsersByIds);
```

`loadOne` accepts two arguments, the first is the step that specifies which
records to load, and the second is the callback function called with these specs
responsible for loading them.

The callback function is called with two arguments, the first is a list of the
values from the step and the second is options that may affect the fetching of
the records.

:::tip

For optimal results, we strongly recommend that the callback function is defined
in a common location so that it can be reused over and over again, rather than
defined inline. This will allow LoadOneStep to optimise calls to this function.

:::

An example of the callback function might be:

```ts
const userByIdCallback = (ids, { attributes }) => {
  // Your business logic would be called here; e.g. this might be the same
  // function that your DataLoaders would call, except we can pass additional
  // information to it:
  return getUsersByIds(ids, { columns: attributes });
};
```
