import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { IdempotencyService } from '../../common/services/idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotencyService: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const idempotencyInfo = (request as any).idempotency;

    if (!idempotencyInfo) {
      return next.handle();
    }

    return next.handle().pipe(
      catchError(async (error) => {
        // If the request fails, we might want to decrement the counter
        // to allow retry (depending on the error type)
        if (this.shouldAllowRetry(error)) {
          await this.decrementCounter(idempotencyInfo.key);
          this.logger.debug(`Decremented idempotency counter for failed request: ${idempotencyInfo.key}`);
        }

        return throwError(() => error);
      }),
    );
  }

  private shouldAllowRetry(error: any): boolean {
    // Allow retry for transient errors (network timeouts, temporary failures)
    const retryableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'NETWORK_ERROR',
      'TEMPORARY_FAILURE',
    ];

    const errorCode = error.code || error.errorCode;
    const errorMessage = error.message || '';

    return retryableErrors.some(code => 
      errorCode === code || errorMessage.includes(code.toLowerCase())
    );
  }

  private async decrementCounter(key: string): Promise<void> {
    try {
      const currentCount = await this.idempotencyService.getCount(key.replace('idempotency:', ''));
      if (currentCount > 0) {
        // Note: Redis doesn't have a direct decrement operation that handles expiration
        // For simplicity, we'll just delete the key to allow immediate retry
        await this.idempotencyService.clearKey(key.replace('idempotency:', ''));
      }
    } catch (error) {
      this.logger.warn(`Failed to decrement idempotency counter: ${key}`, error);
    }
  }
}
