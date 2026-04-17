import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { wikiPageRevisions, wikiPages } from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../errors.js";

/**
 * wiki service — a Karpathy-style LLM wiki for company and project
 * knowledge bases.
 *
 * Design goals (per Peak OS LLM Wiki pattern):
 *  1. Pages are fetched by human-readable `path`, not IDs — agents and
 *     users reason about "decisions/auth.md", not uuids.
 *  2. A compact index is always available so an agent can "scan the
 *     table of contents" before deciding which pages to read fully.
 *  3. `buildAgentContext(query, ...)` returns a pre-concatenated
 *     markdown blob of the most relevant pages — ready to drop into
 *     a system prompt.
 *  4. No vector DB. Keyword matching on title + indexSummary is cheap,
 *     deterministic, and good enough at this scale. Can be upgraded to
 *     embeddings later without changing the caller API.
 *
 * Scope:
 *  - `projectId = null` → company-wide pages (shared knowledge).
 *  - `projectId = <uuid>` → pages specific to a project.
 *  - `buildAgentContext` merges both, giving project pages more weight.
 */

export type WikiScope = { companyId: string; projectId: string | null };

export type WikiPageSummary = {
  id: string;
  path: string;
  title: string | null;
  indexSummary: string | null;
  updatedAt: Date;
  latestRevisionNumber: number;
};

export type WikiPage = WikiPageSummary & {
  companyId: string;
  projectId: string | null;
  content: string;
  format: string;
  createdAt: Date;
};

export type WikiPageWriteInput = {
  path: string;
  content: string;
  title?: string | null;
  indexSummary?: string | null;
  changeSummary?: string | null;
};

export type WikiActor =
  | { userId: string; agentId?: null }
  | { userId?: null; agentId: string };

// Common English stop words we drop when tokenising the query.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "for", "to", "in", "on", "at",
  "by", "with", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "have", "has", "had", "do", "does", "did",
  "will", "would", "should", "could", "may", "might", "can", "what", "when",
  "where", "which", "who", "why", "how", "about", "from", "into", "more",
  "also", "not", "no", "so",
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function normalizePath(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!trimmed) throw unprocessable("path must not be empty");
  if (trimmed.includes("..")) throw unprocessable("path must not contain '..'");
  if (trimmed.length > 512) throw unprocessable("path too long");
  // Default to .md if no extension given
  return trimmed.includes(".") ? trimmed : trimmed + ".md";
}

function deriveTitleFromPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last
    .replace(/\.(md|txt|markdown)$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function scopeCondition(scope: WikiScope) {
  return scope.projectId === null
    ? and(eq(wikiPages.companyId, scope.companyId), isNull(wikiPages.projectId))
    : and(
        eq(wikiPages.companyId, scope.companyId),
        eq(wikiPages.projectId, scope.projectId),
      );
}

export function wikiService(db: Db) {
  // ─── Listing + index ──────────────────────────────────────────────

  /**
   * Lightweight listing — title + one-line summary per page.
   * This is what the UI sidebar and the "index.md" prompt helper both use.
   */
  async function listPages(scope: WikiScope): Promise<WikiPageSummary[]> {
    const rows = await db
      .select({
        id: wikiPages.id,
        path: wikiPages.path,
        title: wikiPages.title,
        indexSummary: wikiPages.indexSummary,
        updatedAt: wikiPages.updatedAt,
        latestRevisionNumber: wikiPages.latestRevisionNumber,
      })
      .from(wikiPages)
      .where(scopeCondition(scope))
      .orderBy(desc(wikiPages.updatedAt));
    return rows;
  }

  /**
   * Build a compact "table of contents" string that an agent can scan.
   * Shape mirrors Karpathy's _index.md:
   *
   *   # Index
   *   - [[decisions/auth]] — rationale for OAuth + JWT choice
   *   - [[requirements/checkout]] — 3 happy-path flows, 2 edge cases
   */
  async function buildIndex(scope: WikiScope): Promise<string> {
    const pages = await listPages(scope);
    if (pages.length === 0) {
      return scope.projectId === null
        ? "# Company Wiki Index\n\n(no pages yet)"
        : "# Project Wiki Index\n\n(no pages yet)";
    }
    const header = scope.projectId === null
      ? "# Company Wiki Index"
      : "# Project Wiki Index";
    const lines = pages.map((p) => {
      const title = p.title || deriveTitleFromPath(p.path);
      const summary = p.indexSummary ? ` — ${p.indexSummary}` : "";
      return `- [[${p.path}]] ${title}${summary}`;
    });
    return [header, "", ...lines].join("\n");
  }

  // ─── Read ────────────────────────────────────────────────────────

  async function getPage(scope: WikiScope, path: string): Promise<WikiPage | null> {
    const normalized = normalizePath(path);
    const rows = await db
      .select()
      .from(wikiPages)
      .where(
        and(
          scopeCondition(scope),
          eq(wikiPages.path, normalized),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.companyId,
      projectId: row.projectId,
      path: row.path,
      title: row.title,
      format: row.format,
      content: row.content,
      indexSummary: row.indexSummary,
      latestRevisionNumber: row.latestRevisionNumber,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function getPageOrThrow(scope: WikiScope, path: string): Promise<WikiPage> {
    const page = await getPage(scope, path);
    if (!page) throw notFound(`Wiki page not found: ${path}`);
    return page;
  }

  // ─── Write (upsert + revision) ───────────────────────────────────

  async function writePage(
    scope: WikiScope,
    input: WikiPageWriteInput,
    actor: WikiActor,
  ): Promise<WikiPage> {
    const path = normalizePath(input.path);
    const title = input.title?.trim() || deriveTitleFromPath(path);

    const actorCols = {
      createdByUserId: actor.userId ?? null,
      createdByAgentId: actor.agentId ?? null,
      updatedByUserId: actor.userId ?? null,
      updatedByAgentId: actor.agentId ?? null,
    };

    // Find existing page
    const existing = await getPage(scope, path);
    const now = new Date();

    if (!existing) {
      // Create new page + revision 1
      const inserted = await db
        .insert(wikiPages)
        .values({
          companyId: scope.companyId,
          projectId: scope.projectId,
          path,
          title,
          content: input.content,
          indexSummary: input.indexSummary?.trim() || null,
          latestRevisionNumber: 1,
          ...actorCols,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const created = inserted[0]!;
      await db.insert(wikiPageRevisions).values({
        companyId: scope.companyId,
        wikiPageId: created.id,
        revisionNumber: 1,
        title,
        content: input.content,
        changeSummary: input.changeSummary?.trim() || null,
        createdByUserId: actor.userId ?? null,
        createdByAgentId: actor.agentId ?? null,
        createdAt: now,
      });

      return {
        id: created.id,
        companyId: created.companyId,
        projectId: created.projectId,
        path: created.path,
        title: created.title,
        format: created.format,
        content: created.content,
        indexSummary: created.indexSummary,
        latestRevisionNumber: created.latestRevisionNumber,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    }

    // Update existing page + append revision
    const nextRevision = existing.latestRevisionNumber + 1;
    const updated = await db
      .update(wikiPages)
      .set({
        title,
        content: input.content,
        indexSummary: input.indexSummary?.trim() ?? existing.indexSummary,
        latestRevisionNumber: nextRevision,
        updatedByUserId: actor.userId ?? null,
        updatedByAgentId: actor.agentId ?? null,
        updatedAt: now,
      })
      .where(eq(wikiPages.id, existing.id))
      .returning();

    const row = updated[0]!;
    await db.insert(wikiPageRevisions).values({
      companyId: scope.companyId,
      wikiPageId: row.id,
      revisionNumber: nextRevision,
      title: row.title,
      content: row.content,
      changeSummary: input.changeSummary?.trim() || null,
      createdByUserId: actor.userId ?? null,
      createdByAgentId: actor.agentId ?? null,
      createdAt: now,
    });

    return {
      id: row.id,
      companyId: row.companyId,
      projectId: row.projectId,
      path: row.path,
      title: row.title,
      format: row.format,
      content: row.content,
      indexSummary: row.indexSummary,
      latestRevisionNumber: row.latestRevisionNumber,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function deletePage(scope: WikiScope, path: string): Promise<void> {
    const page = await getPage(scope, path);
    if (!page) throw notFound(`Wiki page not found: ${path}`);
    await db.delete(wikiPages).where(eq(wikiPages.id, page.id));
    // Revisions cascade-delete via FK.
  }

  // ─── Revisions ───────────────────────────────────────────────────

  async function listRevisions(scope: WikiScope, path: string) {
    const page = await getPageOrThrow(scope, path);
    const rows = await db
      .select({
        revisionNumber: wikiPageRevisions.revisionNumber,
        title: wikiPageRevisions.title,
        changeSummary: wikiPageRevisions.changeSummary,
        createdByUserId: wikiPageRevisions.createdByUserId,
        createdByAgentId: wikiPageRevisions.createdByAgentId,
        createdAt: wikiPageRevisions.createdAt,
      })
      .from(wikiPageRevisions)
      .where(eq(wikiPageRevisions.wikiPageId, page.id))
      .orderBy(desc(wikiPageRevisions.revisionNumber));
    return rows;
  }

  async function getRevision(scope: WikiScope, path: string, revisionNumber: number) {
    const page = await getPageOrThrow(scope, path);
    const rows = await db
      .select()
      .from(wikiPageRevisions)
      .where(
        and(
          eq(wikiPageRevisions.wikiPageId, page.id),
          eq(wikiPageRevisions.revisionNumber, revisionNumber),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound(`Revision ${revisionNumber} not found for ${path}`);
    return row;
  }

  // ─── Agent context builder (Karpathy pattern) ────────────────────

  /**
   * Keyword-score pages by how well their title + indexSummary + path
   * match the query tokens. Returns up to `maxPages` of the highest
   * scoring pages. Ties broken by more recent updatedAt.
   */
  async function findRelevantPages(
    scope: WikiScope,
    query: string,
    maxPages: number = 5,
  ): Promise<WikiPageSummary[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const pages = await listPages(scope);
    const scored = pages.map((p) => {
      const haystack = [
        p.path,
        p.title ?? "",
        p.indexSummary ?? "",
      ]
        .join(" ")
        .toLowerCase();
      const score = tokens.reduce((acc, t) => (haystack.includes(t) ? acc + 1 : acc), 0);
      return { page: p, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.page.updatedAt.getTime() - a.page.updatedAt.getTime();
      })
      .slice(0, maxPages)
      .map((s) => s.page);
  }

  /**
   * Produce a single markdown blob the agent can drop into its system
   * prompt. Always includes the index; then appends the bodies of up to
   * `maxPages` relevant pages, trimmed to `maxChars` total.
   *
   * Scope-aware: when a project context is passed, both company-wide
   * and project-specific pages are merged, with project pages first.
   */
  async function buildAgentContext(args: {
    companyId: string;
    projectId?: string | null;
    query: string;
    maxPages?: number;
    maxChars?: number;
  }): Promise<string> {
    const maxPages = args.maxPages ?? 5;
    const maxChars = args.maxChars ?? 24000;
    const companyScope: WikiScope = { companyId: args.companyId, projectId: null };
    const projectScope: WikiScope | null = args.projectId
      ? { companyId: args.companyId, projectId: args.projectId }
      : null;

    const sections: string[] = [];

    // 1. Always include the indexes so the agent knows what's available.
    if (projectScope) {
      sections.push(await buildIndex(projectScope));
    }
    sections.push(await buildIndex(companyScope));

    // 2. Find relevant pages from both scopes — project pages get priority slots.
    const relevant: WikiPageSummary[] = [];
    if (projectScope) {
      relevant.push(...(await findRelevantPages(projectScope, args.query, maxPages)));
    }
    if (relevant.length < maxPages) {
      relevant.push(
        ...(await findRelevantPages(
          companyScope,
          args.query,
          maxPages - relevant.length,
        )),
      );
    }

    if (relevant.length > 0) {
      sections.push("---\n## Relevant pages loaded\n");
      for (const p of relevant) {
        // Re-fetch full content per page (listPages omits it)
        const scope: WikiScope = projectScope && projectScope.projectId
          ? { companyId: args.companyId, projectId: projectScope.projectId }
          : companyScope;
        const full =
          (await getPage(scope, p.path)) ??
          (await getPage(companyScope, p.path));
        if (!full) continue;
        sections.push(
          `### [[${full.path}]]\n${full.content.trim()}`,
        );
      }
    } else {
      sections.push(
        "_No wiki pages matched this query. Load pages by path if you need specifics._",
      );
    }

    let out = sections.join("\n\n");
    if (out.length > maxChars) {
      out = out.slice(0, maxChars) + "\n\n… (truncated to fit token budget)";
    }
    return out;
  }

  return {
    listPages,
    buildIndex,
    getPage,
    getPageOrThrow,
    writePage,
    deletePage,
    listRevisions,
    getRevision,
    findRelevantPages,
    buildAgentContext,
  };
}
