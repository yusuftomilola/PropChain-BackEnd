import { Injectable, CanActivate, ExecutionContext, BadRequestException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { IdempotencyService } from '../services/idempotency.service';

export interface IdempotencyOptions {
  keyGenerator?: (req: Request) => string;
  windowMs?: number;
  maxDuplicates?: number;
  includeBody?: boolean;
  includeHeaders?: string[];
  includeQuery?: boolean;
}

@Injectable()
export class IdempotencyGuard implements CanActivate {
  private readonly logger = new Logger(IdempotencyGuard.name);

  constructor(
    private readonly idempotencyService: IdempotencyService,
    private readonly options: IdempotencyOptions = {},
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    
    try {
      const key = this.generateKey(request);
      const result = await this.idempotencyService.checkDuplicate(
        key,
        {
          windowMs: this.options.windowMs,
          maxDuplicates: this.options.maxDuplicates,
        },
        {
          method: request.method,
          url: request.url,
          userAgent: request.get('User-Agent'),
          ip: request.ip,
        },
      );

      if (result.isDuplicate) {
        this.logger.warn(`Duplicate request blocked: ${key}`, {
          duplicateCount: result.duplicateCount,
          remainingWindow: result.remainingWindow,
          method: request.method,
          url: request.url,
          ip: request.ip,
        });

        throw new BadRequestException({
          message: 'Duplicate request detected',
          error: 'DUPLICATE_REQUEST',
          duplicateCount: result.duplicateCount,
          remainingWindowMs: result.remainingWindow,
          retryAfter: Math.ceil(result.remainingWindow / 1000),
        });
      }

      // Add idempotency info to request for downstream use
      (request as any).idempotency = {
        key: result.key,
        count: result.duplicateCount + 1,
        remainingWindow: result.remainingWindow,
      };

      return true;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error('Idempotency guard error', error);
      // Fail open - allow the request if idempotency check fails
      return true;
    }
  }

  private generateKey(request: Request): string {
    if (this.options.keyGenerator) {
      return this.options.keyGenerator(request);
    }

    const parts: string[] = [
      request.method,
      request.url.split('?')[0], // Remove query string
    ];

    // Include selected headers
    if (this.options.includeHeaders) {
      for (const header of this.options.includeHeaders) {
        const value = request.get(header);
        if (value) {
          parts.push(`${header}:${value}`);
        }
      }
    }

    // Include query parameters
    if (this.options.includeQuery && request.query) {
      const sortedQuery = Object.keys(request.query)
        .sort()
        .map(key => `${key}=${request.query[key]}`)
        .join('&');
      if (sortedQuery) {
        parts.push(`query:${sortedQuery}`);
      }
    }

    // Include request body (for POST/PUT/PATCH)
    if (this.options.includeBody && request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      try {
        const bodyHash = this.hashBody(request.body);
        parts.push(`body:${bodyHash}`);
      } catch (error) {
        this.logger.warn('Failed to hash request body for idempotency key', error);
      }
    }

    return parts.join(':');
  }

  private hashBody(body: any): string {
    if (typeof body === 'string') {
      return Buffer.from(body).toString('base64').substring(0, 16);
    }

    if (typeof body === 'object' && body !== null) {
      const sortedKeys = Object.keys(body).sort();
      const str = sortedKeys.map(key => `${key}:${body[key]}`).join('|');
      return Buffer.from(str).toString('base64').substring(0, 16);
    }

    return Buffer.from(String(body)).toString('base64').substring(0, 16);
  }
}
