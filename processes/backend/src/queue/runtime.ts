import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
export interface QueuePort {
  enqueue(runId: string): Promise<void>;
  counts(): Promise<Record<string, number>>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}
export function redisConnection(url: string) {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
}
export class BullTaskQueue implements QueuePort {
  readonly queue: Queue;
  readonly redis: Redis;
  constructor(url: string, installation: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', () => {});
    this.queue = new Queue('account-creation', {
      connection: this.redis,
      prefix: `wecode-${installation}`,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    });
    this.queue.on('error', () => {});
  }
  async enqueue(runId: string) {
    await this.queue.add('create-account', { runId }, { jobId: runId });
  }
  async counts() {
    return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
  }
  async pause() {
    await this.queue.pause();
  }
  async resume() {
    await this.queue.resume();
  }
  async close() {
    await this.queue.close();
    this.redis.disconnect();
  }
}
