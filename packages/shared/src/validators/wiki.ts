import { z } from "zod";

export const wikiPageWriteSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(500_000),
  title: z.string().max(200).optional().nullable(),
  indexSummary: z.string().max(300).optional().nullable(),
  changeSummary: z.string().max(500).optional().nullable(),
});
export type WikiPageWrite = z.infer<typeof wikiPageWriteSchema>;

export const wikiPageUpdateSchema = wikiPageWriteSchema.partial();
export type WikiPageUpdate = z.infer<typeof wikiPageUpdateSchema>;

export const wikiContextQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  projectId: z.string().uuid().optional().nullable(),
  maxPages: z.coerce.number().int().min(1).max(20).optional(),
  maxChars: z.coerce.number().int().min(500).max(100_000).optional(),
});
export type WikiContextQuery = z.infer<typeof wikiContextQuerySchema>;
