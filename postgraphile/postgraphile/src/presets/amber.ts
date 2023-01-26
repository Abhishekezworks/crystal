import "graphile-config";

import {
  AddNodeInterfaceToSuitableTypesPlugin,
  defaultPreset as graphileBuildPreset,
  MutationPayloadQueryPlugin,
  NodeAccessorPlugin,
  NodePlugin,
  QueryQueryPlugin,
  SwallowErrorsPlugin,
} from "graphile-build";
import {
  defaultPreset as graphileBuildPgPreset,
  PgAllRowsPlugin,
  PgBasicsPlugin,
  PgCodecsPlugin,
  PgColumnsPlugin,
  PgCustomTypeFieldPlugin,
  PgIntrospectionPlugin,
  PgMutationCreatePlugin,
  PgMutationPayloadEdgePlugin,
  PgMutationUpdateDeletePlugin,
  PgOrderAllColumnsPlugin,
  PgOrderByPrimaryKeyPlugin,
  PgOrderCustomFieldsPlugin,
  PgRelationsPlugin,
  PgRowByUniquePlugin,
  PgTablesPlugin,
  PgTypesPlugin,
} from "graphile-build-pg";

// Shunts the plugins into an order that's more compatible with PostGraphile V4.
export const orderedPlugins: GraphileConfig.Preset = {
  plugins: [
    QueryQueryPlugin,
    PgBasicsPlugin,
    PgCodecsPlugin,
    PgTypesPlugin,
    PgIntrospectionPlugin,
    PgTablesPlugin,
    AddNodeInterfaceToSuitableTypesPlugin,
    NodePlugin,
    PgAllRowsPlugin,
    PgRowByUniquePlugin,
    PgColumnsPlugin,
    MutationPayloadQueryPlugin,
    PgRelationsPlugin,
    PgMutationCreatePlugin,
    PgMutationUpdateDeletePlugin,
    PgCustomTypeFieldPlugin,
    NodeAccessorPlugin,
    PgOrderAllColumnsPlugin,
    PgOrderCustomFieldsPlugin,
    PgOrderByPrimaryKeyPlugin,
    PgMutationPayloadEdgePlugin,
  ],
};

// TODO: should this be PostGraphilePresetAmber?
export const postgraphilePresetAmber: GraphileConfig.Preset = {
  extends: [orderedPlugins, graphileBuildPreset, graphileBuildPgPreset],
  plugins: [SwallowErrorsPlugin],
};

export default postgraphilePresetAmber;
