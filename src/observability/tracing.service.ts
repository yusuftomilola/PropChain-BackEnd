import { Injectable } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-grpc';
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

declare const process: {
  env: Record<string, string | undefined>;
  pid: number;
  on: (event: string, handler: () => void) => void;
  exit: (code?: number) => void;
};

@Injectable()
export class TracingService {
  private sdk: NodeSDK;

  constructor() {
    this.sdk = this.createSDK();
  }

  private createSDK(): NodeSDK {
    const serviceName = process.env.OTEL_SERVICE_NAME || 'propchain-backend';
    const serviceVersion = process.env.OTEL_SERVICE_VERSION || '1.0.0';
    const environment = process.env.NODE_ENV || 'development';
    
    // Configure exporters based on environment
    const exporters = this.getExporters();
    
    return new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
        [SemanticResourceAttributes.HOST_NAME]: process.env.HOSTNAME || 'localhost',
        [SemanticResourceAttributes.PROCESS_PID]: process.pid,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
      spanProcessors: exporters.map(exporter => 
        environment === 'production' 
          ? new BatchSpanProcessor(exporter)
          : new SimpleSpanProcessor(exporter)
      ),
    });
  }

  private getExporters() {
    const exporters: any[] = [new ConsoleSpanExporter()];
    
    // Add OTLP exporter if configured
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      exporters.push(
        new OTLPTraceExporter({
          url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
          headers: this.getAuthHeaders(),
        })
      );
    }
    
    return exporters;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    
    if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
      try {
        const headerPairs = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',');
        headerPairs.forEach(pair => {
          const [key, value] = pair.split('=').map(s => s.trim());
          if (key && value) {
            headers[key] = value;
          }
        });
      } catch (error) {
        console.warn('Failed to parse OTEL_EXPORTER_OTLP_HEADERS:', error);
      }
    }
    
    return headers;
  }

  async init(): Promise<void> {
    try {
      this.sdk.start();
      console.log('OpenTelemetry initialized successfully');
      
      // Graceful shutdown
      process.on('SIGTERM', async () => {
        try {
          await this.sdk.shutdown();
          console.log('OpenTelemetry shut down successfully');
        } catch (error) {
          console.error('Error shutting down OpenTelemetry:', error);
        }
        process.exit(0);
      });
      
    } catch (error) {
      console.warn('Failed to initialize OpenTelemetry:', error);
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.sdk.shutdown();
      console.log('OpenTelemetry shut down successfully');
    } catch (error) {
      console.error('Error shutting down OpenTelemetry:', error);
    }
  }

  createSpan(name: string, attributes?: Record<string, any>) {
    const { trace } = require('@opentelemetry/api');
    const tracer = trace.getTracer('propchain-backend');
    
    return tracer.startSpan(name, {
      attributes: {
        ...attributes,
        'service.name': process.env.OTEL_SERVICE_NAME || 'propchain-backend',
      },
    });
  }
}
