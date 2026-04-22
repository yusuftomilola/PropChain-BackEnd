ALTER TABLE "users"
ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "two_factor_secret" TEXT,
ADD COLUMN "two_factor_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "password_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "blacklisted_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "jti" TEXT NOT NULL,
    "token_type" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklisted_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys"("key_prefix");

CREATE INDEX "password_history_user_id_created_at_idx" ON "password_history"("user_id", "created_at");

CREATE UNIQUE INDEX "blacklisted_tokens_jti_key" ON "blacklisted_tokens"("jti");
CREATE INDEX "blacklisted_tokens_user_id_idx" ON "blacklisted_tokens"("user_id");
CREATE INDEX "blacklisted_tokens_expires_at_idx" ON "blacklisted_tokens"("expires_at");

ALTER TABLE "api_keys"
ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "password_history"
ADD CONSTRAINT "password_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "blacklisted_tokens"
ADD CONSTRAINT "blacklisted_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
