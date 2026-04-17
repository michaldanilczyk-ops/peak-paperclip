import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  wikiPageWriteSchema,
  wikiContextQuerySchema,
  type PermissionKey,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { accessService, logActivity, wikiService } from "../services/index.js";
import type { WikiScope } from "../services/wiki.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";

/**
 * REST surface for the LLM Wiki feature.
 *
 * Scopes:
 *   - /companies/:companyId/wiki/pages               → company-wide wiki
 *   - /companies/:companyId/projects/:projectId/wiki/pages → project wiki
 *
 * GETs need `assertCompanyAccess` only — any member reads.
 * Mutations additionally require the appropriate permission key:
 *   - wiki:edit_company for company-wide pages
 *   - wiki:edit_project for project-scoped pages
 *
 * Agents (as opposed to users) are trusted once they pass `assertCompanyAccess`
 * — they already operate under the agent-level policy surface.
 */
// Shortcut for reading route params with wildcard support.
// Express 5 typing is strict about wildcard captures so we coerce explicitly.
function p(req: Request): Record<string, string | undefined> & { "": string[] | undefined } {
  return req.params as unknown as Record<string, string | undefined> & { "": string[] | undefined };
}

function wildcardPath(req: Request): string {
  // Express 5 / path-to-regexp v8 stores named wildcards under that name.
  // We use `*wikiPath` in route patterns → lives at params.wikiPath (string[]).
  const params = p(req) as unknown as Record<string, string | string[] | undefined>;
  const raw = params.wikiPath;
  if (Array.isArray(raw)) return raw.join("/");
  return typeof raw === "string" ? raw : "";
}

export function wikiRoutes(db: Db) {
  const router = Router();
  const svc = wikiService(db);
  const access = accessService(db);

  // ── Authz helpers ────────────────────────────────────────────────

  async function assertCanEdit(
    req: Request,
    companyId: string,
    key: PermissionKey,
  ): Promise<void> {
    assertCompanyAccess(req, companyId);
    // Agents are trusted in their own company (they already authenticate
    // with company-scoped API keys). User permission keys only gate users.
    if (req.actor.type === "agent") return;
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit") return; // local dev bypass
      if (req.actor.isInstanceAdmin) return;              // instance admin bypass
      const userId = req.actor.userId ?? null;
      const ok = await access.canUser(companyId, userId, key);
      if (!ok) throw forbidden(`Missing permission: ${key}`);
      return;
    }
    throw forbidden("Unsupported actor type for wiki edit");
  }

  function scopeFor(req: Request, isProject: boolean): WikiScope {
    const params = p(req);
    const companyId = params.companyId ?? "";
    if (!isProject) return { companyId, projectId: null };
    return {
      companyId,
      projectId: params.projectId ?? "",
    };
  }

  async function logWikiActivity(
    req: Request,
    companyId: string,
    action: string,
    entityId: string,
    details: Record<string, unknown>,
  ) {
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action,
      entityType: "wiki_page",
      entityId,
      details,
    });
  }

  // ── Route factory — mounts the same 8 endpoints twice, once for
  // company scope and once for project scope. Keeps the code DRY
  // and the two scopes behaviourally identical.

  function mountCrud(
    basePath: string,
    isProject: boolean,
    editPermission: PermissionKey,
  ) {
    // List pages
    router.get(`${basePath}/pages`, async (req, res) => {
      const companyId = p(req).companyId ?? "";
      assertCompanyAccess(req, companyId);
      const pages = await svc.listPages(scopeFor(req, isProject));
      res.json({ pages });
    });

    // Read the index (markdown "table of contents" — useful for agent context)
    router.get(`${basePath}/index`, async (req, res) => {
      const companyId = p(req).companyId ?? "";
      assertCompanyAccess(req, companyId);
      const index = await svc.buildIndex(scopeFor(req, isProject));
      res.type("text/markdown").send(index);
    });

    // Read a specific page (path after /page/ can contain slashes)
    router.get(`${basePath}/page/*wikiPath`, async (req, res) => {
      const companyId = p(req).companyId ?? "";
      assertCompanyAccess(req, companyId);
      const path = wildcardPath(req);
      const page = await svc.getPage(scopeFor(req, isProject), path);
      if (!page) {
        res.status(404).json({ error: "Wiki page not found" });
        return;
      }
      res.json(page);
    });

    // List revisions for a page
    router.get(`${basePath}/revisions/*wikiPath`, async (req, res) => {
      const companyId = p(req).companyId ?? "";
      assertCompanyAccess(req, companyId);
      const path = wildcardPath(req);
      const revisions = await svc.listRevisions(scopeFor(req, isProject), path);
      res.json({ revisions });
    });

    // Get a specific revision
    router.get(`${basePath}/revision/:revisionNumber/*wikiPath`, async (req, res) => {
      const companyId = p(req).companyId ?? "";
      assertCompanyAccess(req, companyId);
      const path = wildcardPath(req);
      const n = Number.parseInt(req.params.revisionNumber as string, 10);
      if (Number.isNaN(n)) {
        res.status(400).json({ error: "Invalid revision number" });
        return;
      }
      const revision = await svc.getRevision(scopeFor(req, isProject), path, n);
      res.json(revision);
    });

    // Write (create-or-update) — wrapped in permission check
    router.put(`${basePath}/page`, validate(wikiPageWriteSchema), async (req, res) => {
      const companyId = p(req).companyId ?? "";
      await assertCanEdit(req, companyId, editPermission);
      const actor = getActorInfo(req);
      const page = await svc.writePage(
        scopeFor(req, isProject),
        req.body,
        actor.actorType === "agent"
          ? { agentId: actor.actorId }
          : { userId: actor.actorId },
      );
      await logWikiActivity(req, companyId, "wiki_page.saved", page.id, {
        path: page.path,
        revision: page.latestRevisionNumber,
        scope: isProject ? "project" : "company",
      });
      res.json(page);
    });

    // Delete
    router.delete(`${basePath}/page/*wikiPath`, async (req, res) => {
      const companyId = p(req).companyId ?? "";
      await assertCanEdit(req, companyId, editPermission);
      const path = wildcardPath(req);
      const existing = await svc.getPage(scopeFor(req, isProject), path);
      await svc.deletePage(scopeFor(req, isProject), path);
      if (existing) {
        await logWikiActivity(req, companyId, "wiki_page.deleted", existing.id, {
          path,
          scope: isProject ? "project" : "company",
        });
      }
      res.json({ ok: true });
    });

    // Agent context builder — returns a markdown blob ready to drop into a prompt
    router.get(`${basePath}/context`, async (req, res) => {
      const params = p(req);
      const companyId = params.companyId ?? "";
      assertCompanyAccess(req, companyId);
      const parsed = wikiContextQuerySchema.parse(req.query);
      const context = await svc.buildAgentContext({
        companyId,
        projectId: isProject ? (params.projectId ?? null) : null,
        query: parsed.query,
        maxPages: parsed.maxPages,
        maxChars: parsed.maxChars,
      });
      res.type("text/markdown").send(context);
    });
  }

  mountCrud("/companies/:companyId/wiki", false, "wiki:edit_company");
  mountCrud(
    "/companies/:companyId/projects/:projectId/wiki",
    true,
    "wiki:edit_project",
  );

  return router;
}
