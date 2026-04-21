import { NextFunction, Request, Response } from "express";

type Options = {
  maxGlobal: number;
  maxPerIp: number;
  key?: (req: Request) => string;
};

export function createConcurrencyLimiter(options: Options) {
  const maxGlobal = options.maxGlobal;
  const maxPerIp = options.maxPerIp;
  const keyFn = options.key ?? ((req) => req.ip || "unknown");

  let globalInFlight = 0;
  const perKey = new Map<string, number>();

  return function concurrencyLimit(req: Request, res: Response, next: NextFunction) {
    const key = keyFn(req);
    const current = perKey.get(key) ?? 0;

    if (globalInFlight >= maxGlobal || current >= maxPerIp) {
      return res.status(429).json({ error: "server busy" });
    }

    globalInFlight++;
    perKey.set(key, current + 1);

    const done = () => {
      globalInFlight = Math.max(0, globalInFlight - 1);
      const now = (perKey.get(key) ?? 1) - 1;
      if (now <= 0) perKey.delete(key);
      else perKey.set(key, now);
    };

    res.once("finish", done);
    res.once("close", done);

    return next();
  };
}

