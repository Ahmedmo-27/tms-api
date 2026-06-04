import { Request, Response, NextFunction } from 'express';

// this is the type of the route handler functions
type AsyncFunction = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<any>;


// this function wraps all route handlersm catches errors and passes them to the error handler middleware in app.ts
export default (execution: AsyncFunction) =>
  (req: Request, res: Response, next: NextFunction) => {
    execution(req, res, next).catch(next);
  };
