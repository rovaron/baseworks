export interface QueueConfig {
  name: string;
  defaultJobOptions?: {
    removeOnComplete?: { age: number };
    removeOnFail?: { age: number };
    attempts?: number;
    backoff?: { type: string; delay: number };
  };
}

export interface WorkerConfig {
  concurrency?: number;
}

export interface EmailJobData {
  to: string;
  template: string;
  data: Record<string, unknown>;
}
