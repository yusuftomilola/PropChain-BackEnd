// Prisma type definitions - These are local type definitions
// that should match the Prisma schema. The actual Prisma client
// types will be generated when prisma generate is run.

// Prisma model name type
export type PrismaModelName =
  | 'User'
  | 'Property'
  | 'PropertyValuation'
  | 'Transaction'
  | 'Role'
  | 'Permission'
  | 'Document'
  | 'ApiKey'
  | 'UserActivity'
  | 'UserRelationship'
  | 'AuditLog'
  | 'Session';

// Type utilities using local definitions
export type PrismaModelNames = PrismaModelName;

export type PrismaSelect<T extends PrismaModelName> = any;
export type PrismaInclude<T extends PrismaModelName> = any;
export type PrismaWhere<T extends PrismaModelName> = any;
export type PrismaWhereUniqueInput = Record<string, unknown>;
export type PrismaPropertyWhereUniqueInput = { id?: string; address?: string };
export type PrismaPropertyWhereInput = Record<string, unknown>;
export type PrismaPropertyOrderByWithRelationInput = Record<string, unknown>;
export type PrismaPropertySelect = Record<string, unknown>;
export type PrismaPropertyInclude = Record<string, unknown>;

// Pagination types
export interface PropertyPaginationOptions {
  cursor?: Prisma.PropertyWhereUniqueInput;
  where?: Prisma.PropertyWhereInput;
  orderBy?: Prisma.PropertyOrderByWithRelationInput | Prisma.PropertyOrderByWithRelationInput[];
  select?: Prisma.PropertySelect;
  include?: Prisma.PropertyInclude;
  take?: number;
  skip?: number;
}

// Prisma client mock for type checking
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Prisma {
  export type ModelName = PrismaModelName;
  export type PropertyWhereUniqueInput = PrismaPropertyWhereUniqueInput;
  export type PropertyWhereInput = PrismaPropertyWhereInput;
  export type PropertyOrderByWithRelationInput = PrismaPropertyOrderByWithRelationInput;
  export type PropertySelect = PrismaPropertySelect;
  export type PropertyInclude = PrismaPropertyInclude;
}

// Export type for model metadata
export interface PrismaModelMetadata {
  modelName: PrismaModelName;
  idField: string;
}
