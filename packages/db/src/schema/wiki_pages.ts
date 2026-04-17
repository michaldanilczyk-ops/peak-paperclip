import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";

/**
 * Wiki page — an addressable markdown document that lives in either the
 * company knowledge base (projectId = null) or a specific project's wiki
 * (projectId set).
 *
 * The Karpathy-wiki pattern: pages are fetched by `path` (e.g.
 * "decisions/auth.md"), listed via a lightweight index derived from
 * `indexSummary`, and concatenated into agent context with a token budget.
 *
 * - Unique on (companyId, projectId, path) so company/project scope is
 *   enforced at the DB level. projectId NULL means company-wide.
 */
export const wikiPages = pgTable(
  "wiki_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    // Nullable: null = company-level wiki page; set = project-level page
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    // File-style path used as the stable human-readable address.
    // E.g. "requirements/checkout-flow.md" or "decisions/auth-strategy.md"
    path: text("path").notNull(),
    title: text("title"),
    format: text("format").notNull().default("markdown"),
    content: text("content").notNull().default(""),
    // One-line description the agent sees first when deciding which pages
    // are relevant. Keep short — a few tokens. Defaults to derived from title.
    indexSummary: text("index_summary"),
    latestRevisionNumber: integer("latest_revision_number").notNull().default(1),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Fast listing by scope (company-level pages: projectId IS NULL)
    companyProjectIdx: index("wiki_pages_company_project_idx").on(
      table.companyId,
      table.projectId,
    ),
    // Latest-first ordering when browsing
    companyProjectUpdatedIdx: index("wiki_pages_company_project_updated_idx").on(
      table.companyId,
      table.projectId,
      table.updatedAt,
    ),
    // A given (company, project?, path) is unique. NULL-safe via coalesce at the
    // migration level — done with a partial index pair for clarity.
    scopePathUq: uniqueIndex("wiki_pages_scope_path_uq").on(
      table.companyId,
      table.projectId,
      table.path,
    ),
  }),
);
