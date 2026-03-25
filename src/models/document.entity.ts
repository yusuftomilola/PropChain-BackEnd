// Document type enum
export type DocumentType =
  | 'TITLE_DEED'
  | 'INSPECTION_REPORT'
  | 'OWNERSHIP_PROOF'
  | 'TAX_DOCUMENT'
  | 'INSURANCE'
  | 'OTHER';
export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

// Document entity type definitions
export interface Document {
  id: string;
  propertyId: string;
  userId: string;
  type: DocumentType;
  status: DocumentStatus;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  description: string | null;
  expiryDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PrismaDocument = Document;
