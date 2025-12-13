import { Request, Response, NextFunction } from "express";
import { hostLog } from "../utils/hostLogger";

function formatResponse(body: any) {
  if (!body) return "null";

  // If already an object
  if (typeof body === "object") {
    return JSON.stringify(body, null, 2);
  }

  // If string, try parsing JSON
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body; // normal string (HTML, text, etc.)
    }
  }

  return String(body);
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
) {
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
──────────────────────────────────────
INCOMING REQUEST
Method      : ${req.method}
URL         : ${req.originalUrl}
IP          : ${req.ip}
Auth        : ${req.headers.authorization ? "Yes" : "No"}
RequestBody :
${JSON.stringify(req.body || {}, null, 2)}

RESPONSE
Status      : ${res.statusCode}
Duration    : ${duration}ms
Response    :
${formatResponse(responseBody)}
──────────────────────────────────────
`;

    hostLog(logData.trim());
  });

  next();
}
