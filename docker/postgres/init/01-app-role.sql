-- =============================================================================
-- Role de APLICAÇÃO (poker_app) - pré-requisito do Row-Level Security (CL-DB-02)
-- =============================================================================
-- Rodado uma única vez pelo entrypoint do Postgres (/docker-entrypoint-initdb.d),
-- como o superuser do cluster (POSTGRES_USER, por padrão "poker"), ANTES de
-- qualquer migration.
--
-- Por que existe: RLS do Postgres é IGNORADO para superusers, para o owner da
-- tabela e para roles com BYPASSRLS. Hoje a aplicação conecta como "poker",
-- que é superuser e owner de tudo - qualquer POLICY criada em CL-DB-03 seria
-- silenciosamente inócua. "poker_app" é NOSUPERUSER/NOBYPASSRLS e não é dono
-- de nenhuma tabela, então as policies valem de fato para ele.
--
-- Divisão de papéis:
--   poker      -> owner. Aplica migrations (DATABASE_URL). Faz DDL.
--   poker_app  -> runtime da aplicação (DATABASE_URL_APP). Só DML, sujeito a RLS.
--
-- Como as migrations continuam sendo aplicadas pelo owner, as tabelas futuras
-- nasceriam sem permissão nenhuma para poker_app - daí o ALTER DEFAULT
-- PRIVILEGES no final, que é o que dispensa re-executar GRANTs a cada migration.
--
-- Sem GRANT em sequences: o schema Prisma não usa autoincrement/serial (ids são
-- uuid() gerados na aplicação), logo não existe sequence a permissionar.

\getenv app_password POKER_APP_DB_PASSWORD

CREATE ROLE poker_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT USAGE ON SCHEMA public TO poker_app;

-- No-op num cluster recém-criado (ainda não há tabelas); mantido para o caso do
-- script ser reaplicado à mão num banco já migrado.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO poker_app;

-- O que realmente cobre as tabelas criadas pelas migrations, daqui pra frente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO poker_app;
