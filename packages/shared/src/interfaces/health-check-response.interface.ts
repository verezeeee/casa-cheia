export type HealthIndicatorStatus = 'up' | 'down';

export interface HealthCheckResponse {
  status: HealthIndicatorStatus;
  info?: Record<string, { status: HealthIndicatorStatus }>;
  error?: Record<string, { status: HealthIndicatorStatus }>;
  details: Record<string, { status: HealthIndicatorStatus }>;
}
