-- Añadido a mano (drizzle-kit no genera extensiones): citext para correo y usuario.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(10) NOT NULL,
	"name" varchar(100),
	"last_sync_seq" bigint DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "devices_platform_chk" CHECK (platform IN ('android','windows','linux','macos')),
	CONSTRAINT "devices_last_sync_seq_chk" CHECK (last_sync_seq >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email" "citext" NOT NULL,
	"type" varchar(20) NOT NULL,
	"token_hash" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_tokens_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "email_tokens_type_chk" CHECK (type IN ('register','reset_password')),
	CONSTRAINT "email_tokens_user_type_chk" CHECK ((type = 'register') = (user_id IS NULL)),
	CONSTRAINT "email_tokens_email_chk" CHECK (email::text = lower(email::text)),
	CONSTRAINT "email_tokens_token_hash_chk" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_tokens_attempts_chk" CHECK (attempts BETWEEN 0 AND 5),
	CONSTRAINT "email_tokens_expires_chk" CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_token_hash_key" UNIQUE("refresh_token_hash"),
	CONSTRAINT "sessions_refresh_token_hash_chk" CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_expires_chk" CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"username" "citext" NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Madrid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_username_key" UNIQUE("username"),
	CONSTRAINT "users_email_chk" CHECK (char_length(email::text) <= 254 AND email::text = lower(email::text) AND strpos(email::text, '@') > 1),
	CONSTRAINT "users_username_chk" CHECK (username::text ~ '^[a-z0-9_]{3,30}$'),
	CONSTRAINT "users_display_name_chk" CHECK (char_length(display_name) BETWEEN 1 AND 100 AND display_name = btrim(display_name)),
	CONSTRAINT "users_password_hash_chk" CHECK (password_hash LIKE '$argon2id$%')
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_devices_user" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_email_tokens_user_type" ON "email_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_tokens_register_pending" ON "email_tokens" USING btree ("email") WHERE type = 'register' AND used_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_family_live" ON "sessions" USING btree ("family_id") WHERE rotated_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sessions_user_live" ON "sessions" USING btree ("user_id") WHERE rotated_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sessions_family" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_device" ON "sessions" USING btree ("device_id");