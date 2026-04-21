import { NextFunction, Request, Response } from "express";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type RateLimitOptions = {
  windowMs: number;
  max: number;
  softMax?: number;
  softDelayMs?: number;
  blockMs?: number;
  key?: (req: Request) => string;
};

type Bucket = {
  count: number;
  resetAt: number;
  blockedUntil: number;
};

export function createRateLimiter(options: RateLimitOptions) {
  const windowMs = options.windowMs;
  const max = options.max;
  const softMax = options.softMax ?? Math.floor(max * 0.8);
  const softDelayMs = options.softDelayMs ?? 200;
  const blockMs = options.blockMs ?? windowMs;
  const keyFn = options.key ?? ((req) => req.ip || "unknown");

  const buckets = new Map<string, Bucket>();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now > b.resetAt + windowMs && now > b.blockedUntil + windowMs) {
        buckets.delete(k);
      }
    }
  }, Math.max(10_000, Math.min(60_000, windowMs)));
  (cleanupTimer as any).unref?.();

  return async function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = keyFn(req);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
      buckets.set(key, bucket);
    }

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
      bucket.blockedUntil = 0;
    }

    if (bucket.blockedUntil && now < bucket.blockedUntil) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.blockedUntil - now) / 1000)));
      return res.status(429).json({ error: "rate limit exceeded" });
    }

    bucket.count++;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      bucket.blockedUntil = now + blockMs;
      res.setHeader("Retry-After", String(Math.ceil(blockMs / 1000)));
      return res.status(429).json({ error: "rate limit exceeded" });
    }

    if (bucket.count > softMax) {
      const over = bucket.count - softMax;
      const delay = Math.min(2_000, softDelayMs * over);
      if (delay > 0) {
        await sleep(delay);
      }
    }

    return next();
  };
}

