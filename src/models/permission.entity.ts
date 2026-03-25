// Permission entity type definitions
export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string;
  createdAt: Date;
}

export type PrismaPermission = Permission;
