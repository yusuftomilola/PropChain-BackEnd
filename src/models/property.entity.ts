// Property status enum
export enum PropertyStatusEnum {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  SOLD = 'SOLD',
  WITHDRAWN = 'WITHDRAWN',
  EXPIRED = 'EXPIRED',
}

export type PropertyStatus = 'ACTIVE' | 'PENDING' | 'SOLD' | 'WITHDRAWN' | 'EXPIRED';

// Property entity type definitions
export interface Property {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  price: number;
  status: PropertyStatus;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  yearBuilt: number;
  features: string[];
  images: string[];
  blockchainHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PrismaProperty = Property;
