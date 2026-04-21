import { Request, Response, NextFunction } from "express";
import { hostLog } from "../utils/hostLogger";

function redactSecrets(input: any): any {
  if (!input || typeof input !== "object") return input;

  if (Array.isArray(input)) {
    return input.map(redactSecrets);
  }

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/password|secret|token|authorization/i.test(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redactSecrets(value);
    }
  }
  return out;
}

function formatResponse(body: any) {
  if (!body) return "null";

  if (typeof body === "object") {
    return JSON.stringify(redactSecrets(body), null, 2);
  }

  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(redactSecrets(parsed), null, 2);
    } catch {
      return body;
    }
  }

  return String(body);
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const oldSend = res.send.bind(res);

  let responseBody: any;

  res.send = (body?: any) => {
    responseBody = body;
    return oldSend(body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    const logData = `
----------------------------------------
INCOMING REQUEST
Method      : ${req.method}
URL         : ${req.originalUrl}
IP          : ${req.ip}
Auth        : ${req.headers.authorization ? "Yes" : "No"}
RequestBody :
${JSON.stringify(redactSecrets(req.body || {}), null, 2)}

RESPONSE
Status      : ${res.statusCode}
Duration    : ${duration}ms
Response    :
${formatResponse(responseBody)}
----------------------------------------
`;

    hostLog(logData.trim());
  });

  next();
}

