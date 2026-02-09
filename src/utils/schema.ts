import { ZodSchema } from "zod";

export function validateSchema<T>(schema: ZodSchema<T>, data: any): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new Error(
      "Schema validation failed:\n" +
      JSON.stringify(result.error.format(), null, 2)
    );
  }

  return result.data;
}
