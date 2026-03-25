// API Key entity type definitions
export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  isActive: boolean;
  rateLimit: number | null;
  keyVersion: number;
  lastRotatedAt: Date | null;
  rotationDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PrismaApiKey = ApiKey;
