import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  DEV_USER_HEADER,
  hasPermission,
  identityBaseUrl,
  IdentityClientError,
  resolveConsumerAuthMode,
  resolvePrincipal,
  type AuthMode,
  type Principal,
  type ResolveOptions,
} from "acme-identity/client";

export type PrincipalResolver = (options: ResolveOptions) => Promise<Principal>;
export type AuthLocals = { principal?: Principal };

export function authMode(): AuthMode {
  return resolveConsumerAuthMode();
}

export function authenticateRequests(
  resolver: PrincipalResolver = resolvePrincipal,
  mode: AuthMode = authMode(),
): RequestHandler {
  return async (req, res, next) => {
    try {
      (res.locals as AuthLocals).principal = await resolver({
        authMode: mode,
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        devUser: header(req, DEV_USER_HEADER),
      });
      next();
    } catch (error) {
      identityError(res, error);
    }
  };
}

export function requirePermission(permission: string): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const principal = principalFrom(res);
    if (!principal) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!hasPermission(principal, permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}

export function principalFrom(res: Response): Principal | undefined {
  return (res.locals as AuthLocals).principal;
}

export function sameOriginWrites(): RequestHandler {
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const site = req.headers["sec-fetch-site"];
    if (site === "same-origin" || site === "none") {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    const expected = `${req.protocol}://${req.headers.host ?? ""}`;
    if (origin.replace(/\/$/, "") === expected) {
      next();
      return;
    }
    res.status(403).json({ error: "Cross-origin request blocked" });
  };
}

export async function proxyIdentitySession(
  fetchFn: typeof fetch,
  req: Request,
  res: Response,
  method: "POST" | "DELETE",
): Promise<void> {
  try {
    const response = await fetchFn(`${identityBaseUrl()}/api/session`, {
      method,
      headers: {
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
      },
      body: method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
      signal: AbortSignal.timeout(3_000),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) res.setHeader("set-cookie", cookie);
    const body = await response.json().catch(() => ({ error: response.statusText }));
    res.status(response.status).json(body);
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : "Identity service unavailable",
    });
  }
}

function identityError(res: Response, error: unknown): void {
  const unavailable = error instanceof IdentityClientError && error.code === "unavailable";
  const config = error instanceof IdentityClientError && error.code === "config";
  res.status(unavailable || config ? 503 : 401).json({
    error: error instanceof Error ? error.message : "Authentication required",
  });
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}
