// Transaction type enum
export type TransactionStatus =
  | 'PENDING'
  | 'ESCROW_FUNDED'
  | 'BLOCKCHAIN_SUBMITTED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';
export type TransactionType = 'PURCHASE' | 'LEASE' | 'TRANSFER';

// Transaction entity type definitions
export interface Transaction {
  id: string;
  propertyId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: TransactionStatus;
  type: TransactionType;
  blockchainHash: string | null;
  escrowWallet: string | null;
  platformFee: number;
  gasFee: number;
  confirmations: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PrismaTransaction = Transaction;
