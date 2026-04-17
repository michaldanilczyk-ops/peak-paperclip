import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileText, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { wikiApi, type WikiPage, type WikiPageSummary } from "../api/wiki";
import { useParams } from "@/lib/router";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Scope = { kind: "company" } | { kind: "project"; projectId: string };

/**
 * Wiki page — an LLM knowledge base using the Karpathy pattern:
 * an always-visible index, pages addressable by path, versioned, and
 * available to agents via the /context endpoint.
 *
 * Reachable via:
 *   - /wiki              → company-wide wiki (current company)
 *   - /projects/:projectId/wiki → project-scoped wiki
 *
 * Both use the same component — `useParams` tells us the scope.
 */
export function Wiki() {
  const { selectedCompanyId } = useCompany();
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : null;
  const scope: Scope = projectId
    ? { kind: "project", projectId }
    : { kind: "company" };
  const scopeProjectId = scope.kind === "project" ? scope.projectId : null;
  const companyId = selectedCompanyId;

  const queryClient = useQueryClient();
  const toast = useToastActions();
  const cacheKey = ["wiki", companyId, scopeProjectId] as const;

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorSummary, setEditorSummary] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [isNew, setIsNew] = useState(false);

  // Listing
  const pagesQuery = useQuery({
    queryKey: [...cacheKey, "pages"],
    queryFn: () => {
      if (!companyId) return Promise.resolve({ pages: [] });
      return wikiApi.listPages(companyId, scopeProjectId);
    },
    enabled: Boolean(companyId),
  });

  // Selected page content
  const pageQuery = useQuery({
    queryKey: [...cacheKey, "page", selectedPath],
    queryFn: () => {
      if (!companyId || !selectedPath) return Promise.resolve(null as WikiPage | null);
      return wikiApi.getPage(companyId, scopeProjectId, selectedPath);
    },
    enabled: Boolean(companyId && selectedPath),
  });

  // Sync editor when page loads
  useEffect(() => {
    if (pageQuery.data) {
      setEditorPath(pageQuery.data.path);
      setEditorTitle(pageQuery.data.title ?? "");
      setEditorSummary(pageQuery.data.indexSummary ?? "");
      setEditorContent(pageQuery.data.content);
      setIsNew(false);
    }
  }, [pageQuery.data]);

  const savePageMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("No company selected");
      return wikiApi.writePage(companyId, scopeProjectId, {
        path: editorPath.trim(),
        content: editorContent,
        title: editorTitle.trim() || null,
        indexSummary: editorSummary.trim() || null,
      });
    },
    onSuccess: (saved) => {
      toast.pushToast({ title: `Saved ${saved.path}`, tone: "success" });
      queryClient.invalidateQueries({ queryKey: cacheKey });
      setSelectedPath(saved.path);
      setIsNew(false);
    },
    onError: (err) => toast.pushToast({ title: errorMessage(err), tone: "error" }),
  });

  const deletePageMutation = useMutation({
    mutationFn: (path: string) => {
      if (!companyId) throw new Error("No company selected");
      return wikiApi.deletePage(companyId, scopeProjectId, path);
    },
    onSuccess: () => {
      toast.pushToast({ title: "Page deleted", tone: "success" });
      queryClient.invalidateQueries({ queryKey: cacheKey });
      setSelectedPath(null);
      setEditorPath("");
      setEditorContent("");
    },
    onError: (err) => toast.pushToast({ title: errorMessage(err), tone: "error" }),
  });

  const startNewPage = () => {
    setSelectedPath(null);
    setIsNew(true);
    setEditorPath("");
    setEditorTitle("");
    setEditorSummary("");
    setEditorContent("# New page\n\nStart writing here...");
  };

  const pages: WikiPageSummary[] = pagesQuery.data?.pages ?? [];

  const scopeLabel = scope.kind === "company" ? "Company Wiki" : "Project Wiki";
  const scopeDescription = scope.kind === "company"
    ? "Organization-wide knowledge. Agents read this context across every project."
    : "Project-specific knowledge. Agents working on this project see both the project wiki and the company wiki.";

  if (!companyId) {
    return (
      <EmptyState
        icon={BookOpen}
        message="Pick a company from the sidebar to open its wiki."
      />
    );
  }

  if (pagesQuery.isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{scopeLabel}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{scopeDescription}</p>
        </div>
        <Button onClick={startNewPage} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          New page
        </Button>
      </div>

      <div className="grid flex-1 grid-cols-[320px_1fr] overflow-hidden">
        {/* Index (left pane) */}
        <div className="overflow-y-auto border-r border-border">
          {pages.length === 0 && !isNew ? (
            <div className="p-6">
              <EmptyState
                icon={FileText}
                message={
                  scope.kind === "company"
                    ? "No pages yet. Create a page to start capturing company knowledge your agents will read."
                    : "No pages yet. Project-specific knowledge lives here — create your first page to begin."
                }
                action="Create first page"
                onAction={startNewPage}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {pages.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedPath(p.path)}
                    className={`block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50 ${
                      selectedPath === p.path ? "bg-accent" : ""
                    }`}
                  >
                    <div className="font-mono text-xs text-muted-foreground">
                      {p.path}
                    </div>
                    {p.title && (
                      <div className="mt-0.5 font-medium">{p.title}</div>
                    )}
                    {p.indexSummary && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {p.indexSummary}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      rev {p.latestRevisionNumber} ·{" "}
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Editor (right pane) */}
        <div className="flex flex-col overflow-hidden">
          {isNew || selectedPath ? (
            <>
              <div className="flex flex-col gap-2 border-b border-border p-4">
                <div className="grid grid-cols-[140px_1fr] items-center gap-2 text-sm">
                  <label className="font-medium text-muted-foreground">Path</label>
                  <Input
                    value={editorPath}
                    onChange={(e) => setEditorPath(e.target.value)}
                    placeholder="e.g. decisions/auth-strategy.md"
                    className="font-mono text-xs"
                    disabled={!isNew}
                  />
                </div>
                <div className="grid grid-cols-[140px_1fr] items-center gap-2 text-sm">
                  <label className="font-medium text-muted-foreground">Title</label>
                  <Input
                    value={editorTitle}
                    onChange={(e) => setEditorTitle(e.target.value)}
                    placeholder="Auto-derived from path"
                  />
                </div>
                <div className="grid grid-cols-[140px_1fr] items-center gap-2 text-sm">
                  <label className="font-medium text-muted-foreground">
                    Index summary
                  </label>
                  <Input
                    value={editorSummary}
                    onChange={(e) => setEditorSummary(e.target.value)}
                    placeholder="One line — what agents see first. Keep short."
                  />
                </div>
              </div>

              <div className="flex-1 overflow-hidden p-4">
                <Textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="h-full min-h-[400px] resize-none font-mono text-sm"
                  placeholder="# Title\n\nWrite markdown here. Link to other pages with [[path/to/page.md]]."
                />
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <div className="text-xs text-muted-foreground">
                  {pageQuery.data
                    ? `Revision ${pageQuery.data.latestRevisionNumber} · Updated ${new Date(pageQuery.data.updatedAt).toLocaleString()}`
                    : isNew
                    ? "New page (unsaved)"
                    : ""}
                </div>
                <div className="flex gap-2">
                  {selectedPath && !isNew && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete ${selectedPath}?`)) {
                          deletePageMutation.mutate(selectedPath);
                        }
                      }}
                      disabled={deletePageMutation.isPending}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => savePageMutation.mutate()}
                    disabled={
                      savePageMutation.isPending || !editorPath.trim()
                    }
                  >
                    <Save className="mr-1.5 h-4 w-4" />
                    {savePageMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={FileText}
                message="Select a page from the left, or create a new one. The index shows every page in this wiki."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
