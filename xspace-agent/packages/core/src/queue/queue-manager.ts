// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Queue System — Manager
// =============================================================================

import { Queue, Worker, QueueEvents, type ConnectionOptions, type Job } from 'bullmq'
import type {
  QueueConfig,
  QueueDefinition,
  QueueStats,
  JobInfo,
  JobTypeMap,
  QueueName,
  DEFAULT_QUEUES,
} from './types'

export type Processor<T = unknown> = (job: Job<T>) => Promise<unknown>

export class QueueManager {
  private queues = new Map<string, Queue>()
  private workers = new Map<string, Worker>()
  private queueEvents = new Map<string, QueueEvents>()
  private connection: ConnectionOptions
  private prefix: string

  constructor(config: QueueConfig = {}) {
    const url = config.redisUrl ?? process.env.REDIS_URL
    if (url) {
      // BullMQ accepts IORedis-compatible options; parse URL into host/port/password
      const parsed = new URL(url)
      this.connection = {
        host: parsed.hostname,
        port: Number(parsed.port) || 6379,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      }
    } else {
      this.connection = {
        host: config.redisHost ?? 'localhost',
        port: config.redisPort ?? 6379,
        password: config.redisPassword,
      }
    }
    this.prefix = config.prefix ?? 'xspace:queue:'
  }

  // ---------------------------------------------------------------------------
  // Queue registration
  // ---------------------------------------------------------------------------

  /**
   * Register a queue. If it already exists, returns the existing instance.
   */
  registerQueue(name: string, definition?: Partial<QueueDefinition>): Queue {
    if (this.queues.has(name)) return this.queues.get(name)!

    const queue = new Queue(name, {
      connection: this.connection,
      prefix: this.prefix,
      defaultJobOptions: {
        attempts: definition?.maxRetries ?? 3,
        backoff: {
          type: definition?.backoffType ?? 'exponential',
          delay: definition?.backoffDelay ?? 1_000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    })

    this.queues.set(name, queue)
    return queue
  }

  /**
   * Register a worker for a queue.
   */
  registerWorker<T = unknown>(
    name: string,
    processor: Processor<T>,
    options?: { concurrency?: number; limiter?: { max: number; duration: number } },
  ): Worker<T> {
    if (this.workers.has(name)) {
      throw new Error(`Worker already registered for queue "${name}"`)
    }

    const worker = new Worker<T>(name, processor as any, {
      connection: this.connection,
      prefix: this.prefix,
      concurrency: options?.concurrency ?? 5,
      limiter: options?.limiter,
    })

    this.workers.set(name, worker as Worker)
    return worker
  }

  /**
   * Get a queue by name. Throws if not registered.
   */
  getQueue<N extends QueueName>(name: N): Queue<JobTypeMap[N]>
  getQueue(name: string): Queue
  getQueue(name: string): Queue {
    const queue = this.queues.get(name)
    if (!queue) throw new Error(`Queue "${name}" not registered`)
    return queue
  }

  /**
   * Add a job to a named queue with type safety.
   */
  async addJob<N extends QueueName>(
    queueName: N,
    jobName: string,
    data: JobTypeMap[N],
    options?: { priority?: number; delay?: number; attempts?: number },
  ): Promise<Job<JobTypeMap[N]>> {
    const queue = this.getQueue(queueName) as Queue<JobTypeMap[N]>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return queue.add(jobName as any, data as any, {
      priority: options?.priority,
      delay: options?.delay,
      attempts: options?.attempts,
    })
  }

  // ---------------------------------------------------------------------------
  // Queue events
  // ---------------------------------------------------------------------------

  /**
   * Get or create a QueueEvents instance for a queue.
   */
  getQueueEvents(name: string): QueueEvents {
    if (this.queueEvents.has(name)) return this.queueEvents.get(name)!

    const events = new QueueEvents(name, {
      connection: this.connection,
      prefix: this.prefix,
    })
    this.queueEvents.set(name, events)
    return events
  }

  // ---------------------------------------------------------------------------
  // Admin operations
  // ---------------------------------------------------------------------------

  /**
   * Get stats for all registered queues.
   */
  async getQueueStats(): Promise<QueueStats[]> {
    const stats: QueueStats[] = []

    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      )
      stats.push({
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        paused: (counts.paused ?? 0) > 0 || (await queue.isPaused()),
      })
    }

    return stats
  }

  /**
   * Get stats for a single queue.
   */
  async getSingleQueueStats(name: string): Promise<QueueStats> {
    const queue = this.getQueue(name)
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    )
    return {
      name,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      paused: (counts.paused ?? 0) > 0 || (await queue.isPaused()),
    }
  }

  /**
   * List jobs in a queue filtered by status.
   */
  async getJobs(
    name: string,
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' = 'waiting',
    start = 0,
    end = 25,
  ): Promise<JobInfo[]> {
    const queue = this.getQueue(name)
    const jobs = await queue.getJobs([status], start, end)

    return jobs.map((job) => ({
      id: job.id ?? '',
      name: job.name,
      data: job.data,
      status,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      timestamp: job.timestamp,
    }))
  }

  /**
   * Pause a queue.
   */
  async pauseQueue(name: string): Promise<void> {
    const queue = this.getQueue(name)
    await queue.pause()
  }

  /**
   * Resume a paused queue.
   */
  async resumeQueue(name: string): Promise<void> {
    const queue = this.getQueue(name)
    await queue.resume()
  }

  /**
   * Drain (remove all waiting jobs from) a queue.
   */
  async drainQueue(name: string): Promise<void> {
    const queue = this.getQueue(name)
    await queue.drain()
  }

  /**
   * Retry all failed jobs in a queue. Returns number of retried jobs.
   */
  async retryFailedJobs(name: string): Promise<number> {
    const queue = this.getQueue(name)
    const failed = await queue.getJobs(['failed'])
    let retried = 0
    for (const job of failed) {
      await job.retry()
      retried++
    }
    return retried
  }

  /**
   * List all registered queue names.
   */
  getRegisteredQueues(): string[] {
    return Array.from(this.queues.keys())
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Gracefully close all queues, workers, and event listeners.
   */
  async close(): Promise<void> {
    const closeOps: Promise<void>[] = []

    for (const worker of this.workers.values()) {
      closeOps.push(worker.close())
    }
    for (const events of this.queueEvents.values()) {
      closeOps.push(events.close())
    }
    for (const queue of this.queues.values()) {
      closeOps.push(queue.close())
    }

    await Promise.all(closeOps)

    this.workers.clear()
    this.queueEvents.clear()
    this.queues.clear()
  }
}


