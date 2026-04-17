CREATE TABLE "wiki_page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"wiki_page_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"change_summary" text,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"path" text NOT NULL,
	"title" text,
	"format" text DEFAULT 'markdown' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"index_summary" text,
	"latest_revision_number" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"updated_by_user_id" text,
	"updated_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_page_revisions_page_revision_uq" ON "wiki_page_revisions" USING btree ("wiki_page_id","revision_number");--> statement-breakpoint
CREATE INDEX "wiki_page_revisions_company_page_created_idx" ON "wiki_page_revisions" USING btree ("company_id","wiki_page_id","created_at");--> statement-breakpoint
CREATE INDEX "wiki_pages_company_project_idx" ON "wiki_pages" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "wiki_pages_company_project_updated_idx" ON "wiki_pages" USING btree ("company_id","project_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_pages_scope_path_uq" ON "wiki_pages" USING btree ("company_id","project_id","path");