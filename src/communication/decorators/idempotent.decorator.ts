import { SetMetadata } from '@nestjs/common';
import { IdempotencyOptions } from '../../common/guards/idempotency.guard';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Decorator to mark a route as idempotent with specific options
 */
export const Idempotent = (options: IdempotencyOptions = {}) => 
  SetMetadata(IDEMPOTENT_KEY, options);
