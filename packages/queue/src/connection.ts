import IORedis from "ioredis";

let connection: IORedis | null = null;
let currentUrl: string | null = null;

/**
 * Get a singleton Redis connection configured for BullMQ.
 * Uses maxRetriesPerRequest: null as required by BullMQ.
 */
export function getRedisConnection(url: string): IORedis {
  if (connection && currentUrl === url) {
    return connection;
  }

  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
  });
  currentUrl = url;

  return connection;
}

/**
 * Close the singleton Redis connection and reset state.
 */
export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
    currentUrl = null;
  }
}
