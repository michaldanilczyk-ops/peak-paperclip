import type { WikiPageWrite } from "@paperclipai/shared";
import { api } from "./client";

export type WikiPage = {
  id: string;
  companyId: string;
  projectId: string | null;
  path: string;
  title: string | null;
  format: string;
  content: string;
  indexSummary: string | null;
  latestRevisionNumber: number;
  createdAt: string;
  updatedAt: string;
};

export type WikiPageSummary = Pick<
  WikiPage,
  "id" | "path" | "title" | "indexSummary" | "updatedAt" | "latestRevisionNumber"
>;

export type WikiRevision = {
  revisionNumber: number;
  title: string | null;
  changeSummary: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: string;
};

/**
 * Thin wrapper over the wiki REST endpoints. The same 7 endpoints live
 * twice on the server — once at /companies/:companyId/wiki/... (company
 * scope) and once at /companies/:companyId/projects/:projectId/wiki/...
 * (project scope). This client mirrors that shape with a `scope` arg.
 */

function base(companyId: string, projectId: string | null): string {
  return projectId
    ? `/companies/${companyId}/projects/${projectId}/wiki`
    : `/companies/${companyId}/wiki`;
}

export const wikiApi = {
  listPages: (companyId: string, projectId: string | null) =>
    api.get<{ pages: WikiPageSummary[] }>(`${base(companyId, projectId)}/pages`),

  getPage: (companyId: string, projectId: string | null, path: string) =>
    api.get<WikiPage>(`${base(companyId, projectId)}/page/${path}`),

  writePage: (companyId: string, projectId: string | null, body: WikiPageWrite) =>
    api.put<WikiPage>(`${base(companyId, projectId)}/page`, body),

  deletePage: (companyId: string, projectId: string | null, path: string) =>
    api.delete<{ ok: true }>(`${base(companyId, projectId)}/page/${path}`),

  listRevisions: (companyId: string, projectId: string | null, path: string) =>
    api.get<{ revisions: WikiRevision[] }>(
      `${base(companyId, projectId)}/revisions/${path}`,
    ),
};
