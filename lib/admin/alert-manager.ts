import { Redis } from '@upstash/redis';
import { sendOpsNotification } from './notifier.js';

export type AlertType =
  | 'timeout_streak'
  | 'code_fetch_failure_streak'
  | 'ingest_failure_streak'
  | 'github_rate_limit_low';

export interface AlertContext {
  repo?: string;
  route?: string;
  value?: number;
  threshold?: number;
  streakCount?: number;
}

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!_redis) {
    _redis = new Redis({ url, token });
  }
  return _redis;
}

const ALERT_SUPPRESS_SECONDS = Number(
  process.env.ALERT_SUPPRESS_SECONDS ?? 3600,
);

function streakKey(type: AlertType, repo: string): string {
  return `rag:alert:streak:${type}:${repo}`;
}

function suppressKey(type: AlertType, repo: string): string {
  return `rag:alert:suppress:${type}:${repo}`;
}

/** Increment the streak counter for (type, repo) and return the new count */
export async function incrementAlertStreak(
  type: AlertType,
  repo: string,
): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    const count = await r.incr(streakKey(type, repo));
    return count;
  } catch {
    return 0;
  }
}

/** Reset (delete) the streak counter for (type, repo) */
export async function resetAlertStreak(
  type: AlertType,
  repo: string,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(streakKey(type, repo));
  } catch {
    // ignore
  }
}

/**
 * If streak count >= threshold and no suppress key exists:
 *  - send an ops notification
 *  - write suppress key with TTL
 */
export async function checkAndFireStreakAlert(
  type: AlertType,
  repo: string,
  threshold: number,
  context: AlertContext,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const [countRaw, suppressed] = await Promise.all([
      r.get<number>(streakKey(type, repo)),
      r.exists(suppressKey(type, repo)),
    ]);
    const count = countRaw ?? 0;
    if (count < threshold || suppressed) return;

    await sendOpsNotification({
      level: 'WARN',
      scenario: 'live_alert',
      subject: `Alert: ${type} streak reached ${count} for ${repo}`,
      body: buildAlertBody(type, { ...context, streakCount: count, threshold }),
      repo,
      alertType: type,
    });

    await r.set(suppressKey(type, repo), '1', { ex: ALERT_SUPPRESS_SECONDS });
  } catch {
    // never throw from alert code
  }
}

/**
 * Stateless threshold check: if currentValue <= threshold and no suppress key:
 *  - send ops notification
 *  - write suppress key with TTL
 */
export async function checkThresholdAlert(
  type: AlertType,
  repo: string,
  currentValue: number,
  threshold: number,
  context: AlertContext,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const suppressed = await r.exists(suppressKey(type, repo));
    if (currentValue > threshold || suppressed) return;

    await sendOpsNotification({
      level: 'WARN',
      scenario: 'live_alert',
      subject: `Alert: ${type} value ${currentValue} below threshold ${threshold} for ${repo}`,
      body: buildAlertBody(type, { ...context, value: currentValue, threshold }),
      repo,
      alertType: type,
    });

    await r.set(suppressKey(type, repo), '1', { ex: ALERT_SUPPRESS_SECONDS });
  } catch {
    // never throw from alert code
  }
}

function buildAlertBody(type: AlertType, context: AlertContext): string {
  const lines: string[] = [`Alert type: ${type}`];
  if (context.repo) lines.push(`Repo: ${context.repo}`);
  if (context.route) lines.push(`Route: ${context.route}`);
  if (context.streakCount !== undefined)
    lines.push(`Streak count: ${context.streakCount}`);
  if (context.threshold !== undefined)
    lines.push(`Threshold: ${context.threshold}`);
  if (context.value !== undefined) lines.push(`Value: ${context.value}`);
  return lines.join('\n');
}
