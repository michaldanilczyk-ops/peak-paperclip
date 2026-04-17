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
import { wikiPages } from "./wiki_pages.js";
import { agents } from "./agents.js";

/**
 * Immutable revisions for a wiki page — every write creates one.
 * Mirrors the `documents` / `document_revisions` pairing already used
 * elsewhere in Paperclip for audit + rollback.
 */
export const wikiPageRevisions = pgTable(
  "wiki_page_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    wikiPageId: uuid("wiki_page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    changeSummary: text("change_summary"),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pageRevisionUq: uniqueIndex("wiki_page_revisions_page_revision_uq").on(
      table.wikiPageId,
      table.revisionNumber,
    ),
    companyPageCreatedIdx: index("wiki_page_revisions_company_page_created_idx").on(
      table.companyId,
      table.wikiPageId,
      table.createdAt,
    ),
  }),
);
