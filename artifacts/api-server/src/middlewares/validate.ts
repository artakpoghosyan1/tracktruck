import type { Request, Response, NextFunction, RequestHandler } from "express";

interface ZodLikeSchema {
  safeParse(data: unknown): {
    success: boolean;
    error?: {
      issues: Array<{
        path: Array<string | number>;
        message: string;
      }>;
    };
  };
}

interface ValidationSchemas {
  body?: ZodLikeSchema;
  params?: ZodLikeSchema;
  query?: ZodLikeSchema;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Array<{ location: string; issues: Array<{ path: string; message: string }> }> = [];

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success && result.error) {
        errors.push({
          location: "params",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        });
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success && result.error) {
        errors.push({
          location: "query",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        });
      }
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success && result.error) {
        errors.push({
          location: "body",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        });
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: "validation_error",
        message: "Request validation failed",
        details: errors,
      });
      return;
    }

    next();
  };
}
