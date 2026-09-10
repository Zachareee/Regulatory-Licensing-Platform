import { NextFunction, Request, Response } from 'express';
import { Role } from '../../domain/types';

export interface AuthedRequest extends Request {
  user?: { id: string; role: Role };
}

/**
 * Mock authentication (see SCOPE.md). A real deployment would verify a
 * session/JWT issued by the government SSO provider; here we trust
 * `X-User-Id` / `X-User-Role` headers, but — importantly — every route
 * still goes through role-authorization checks in the service layer, so
 * swapping this middleware for real auth requires no service changes.
 */
export function mockAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const id = req.header('X-User-Id');
  const role = req.header('X-User-Role');

  if (!id || !role) {
    res.status(401).json({ error: 'Missing X-User-Id / X-User-Role headers' });
    return;
  }
  if (role !== 'OPERATOR' && role !== 'OFFICER') {
    res.status(401).json({ error: 'X-User-Role must be OPERATOR or OFFICER' });
    return;
  }

  req.user = { id, role: role as Role };
  next();
}

export function requireRole(role: Role) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: `This action requires role ${role}` });
      return;
    }
    next();
  };
}
