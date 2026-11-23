import type { RequestHandler } from 'express';

/** Passes a rejected promise from an async handler to Express's error handler (Express 4 doesn't) */
export const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
