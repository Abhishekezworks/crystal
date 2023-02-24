import type { WithPgClient } from "@dataplan/pg";
import type { PromiseOrDirect } from "grafast";

export interface PgSourceTags extends PgSmartTagsDict {
  name: string;

  /** For a computed column function/etc, what field name should we use? */
  fieldName: string;
  /** For a computed column function that performs a mutation, what field name should we use on the payload to store the result? */
  resultFieldName: string;
  behavior: string | string[];
  primaryKey: string;
  foreignKey: string | string[];
  unique: string | string[];
  deprecated: string | string[];
}

export interface PgSourceUniqueTags extends PgSmartTagsDict {
  /** The field name for the root-level accessor for a row by this unique constraint */
  fieldName: string;
  behavior: string | string[];
}

export interface PgSourceRelationTags extends PgSmartTagsDict {
  behavior: string | string[];
  deprecated: string | string[];
}

export interface PgSourceRefTags extends PgSmartTagsDict {
  behavior: string | string[];
  deprecated: string | string[];
}

export interface PgTypeColumnTags extends PgSmartTagsDict {
  name: string;
  behavior: string | string[];
  notNull: true;
}

export interface PgTypeCodecTags extends PgSmartTagsDict {
  behavior: string | string[];
  deprecated: string | string[];
  implements: string | string[];
  interface: string;
  name: string;
  unionMember: string | string[];
}

export interface PgSmartTagsDict {
  [tagName: string]: null | true | string | (string | true)[];
}

export interface PgAdaptor<
  TAdaptor extends keyof GraphileConfig.PgDatabaseAdaptorOptions = keyof GraphileConfig.PgDatabaseAdaptorOptions,
> {
  createWithPgClient: (
    adaptorSettings: GraphileConfig.PgDatabaseConfiguration<TAdaptor>["adaptorSettings"],
    variant?: "SUPERUSER" | null,
  ) => PromiseOrDirect<WithPgClient>;
}

/*
 * Declaration merging to add graphile-build-pg 'tags' to @dataplan/pg
 * extensions so we can easily use them with TypeScript.
 */
declare module "@dataplan/pg" {
  interface PgSourceExtensions {
    tags: Partial<PgSourceTags>;
    description?: string;
    singleOutputParameterName?: string;
    /** For v4 compatibility, what's the name of the actual table. */
    pg?: {
      databaseName: string;
      schemaName: string;
      name: string;
    };
  }

  interface PgSourceUniqueExtensions {
    tags: Partial<PgSourceUniqueTags>;
    description?: string;
  }

  interface PgSourceRelationExtensions {
    tags: Partial<PgSourceRelationTags>;
    description?: string;
  }

  interface PgSourceRefExtensions {
    tags: Partial<PgSourceRefTags>;
    description?: string;
  }

  interface PgTypeColumnExtensions {
    tags: Partial<PgTypeColumnTags>;
    description?: string;
  }

  interface PgTypeCodecExtensions {
    /** If false but the codec has columns then it's probably a composite type */
    isTableLike?: boolean;
    tags: Partial<PgTypeCodecTags>;
    description?: string;
  }
}
