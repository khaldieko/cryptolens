import Redis from "ioredis";
import { config } from "./config";

export const redis = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 });

/** Get JSON from cache, or compute+store it with a TTL (seconds). */
export async function cached<T>(key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await compute();
  await redis.set(key, JSON.stringify(value), "EX", ttl);
  return value;
}
