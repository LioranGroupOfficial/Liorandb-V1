import { ZodSchema } from "zod";
import { LiorandbError } from "./errors.js";

export function validateSchema<T>(schema: ZodSchema<T>, data: any): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new LiorandbError("VALIDATION_FAILED", "Schema validation failed", {
      details: {
        issues: result.error.format()
      }
    });
  }

  return result.data;
}
