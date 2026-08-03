-- Corrige manualmente la columna "type" de ofapi_client_transactions.
--
-- Motivo: Sequelize (sync({ alter: true })) genera SQL invalido para esta
-- columna porque combina ENUM + comment: adjunta la clausula USING(...) a la
-- sentencia COMMENT ON COLUMN en vez de a ALTER COLUMN ... TYPE, lo que
-- Postgres rechaza con "error de sintaxis en o cerca de USING". Este script
-- aplica el mismo objetivo (tipo ENUM, NOT NULL, sin default, comentario)
-- pero con las sentencias en el orden correcto.
--
-- Es idempotente: puede ejecutarse mas de una vez sin error.
-- Ejecutar con: psql "<connection_string>" -f scripts/fix_client_transactions_type_enum.sql
-- (o pegarlo en pgAdmin / el cliente que uses contra la base de PRD)

BEGIN;

-- 1. Crear el tipo ENUM si aun no existe
DO $$
BEGIN
  CREATE TYPE "public"."enum_ofapi_client_transactions_type" AS ENUM ('credit', 'debit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Convertir la columna al tipo ENUM solo si todavia no lo es
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT udt_name INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ofapi_client_transactions'
    AND column_name = 'type';

  IF current_type IS NULL THEN
    RAISE EXCEPTION 'No se encontro la columna ofapi_client_transactions.type. Revisa el nombre de tabla/schema.';
  END IF;

  IF current_type IS DISTINCT FROM 'enum_ofapi_client_transactions_type' THEN
    RAISE NOTICE 'Columna type es actualmente %, convirtiendo a ENUM...', current_type;
    EXECUTE 'ALTER TABLE "ofapi_client_transactions" ALTER COLUMN "type" DROP DEFAULT';
    EXECUTE 'ALTER TABLE "ofapi_client_transactions" ALTER COLUMN "type" TYPE "public"."enum_ofapi_client_transactions_type" USING ("type"::text::"public"."enum_ofapi_client_transactions_type")';
  ELSE
    RAISE NOTICE 'Columna type ya es del tipo ENUM correcto, se omite la conversion.';
  END IF;
END $$;

-- 3. Forzar NOT NULL, pero primero verificar que no haya NULLs existentes
DO $$
DECLARE
  null_count bigint;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM "ofapi_client_transactions"
  WHERE "type" IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'Hay % fila(s) con type = NULL. Corrige esos datos manualmente antes de aplicar NOT NULL.', null_count;
  END IF;

  ALTER TABLE "ofapi_client_transactions" ALTER COLUMN "type" SET NOT NULL;
END $$;

-- 4. Comentario de columna, como sentencia independiente (sin USING)
COMMENT ON COLUMN "ofapi_client_transactions"."type" IS '''credit'' = recarga, ''debit'' = consumo';

COMMIT;

-- Verificacion rapida post-ejecucion:
-- SELECT column_name, udt_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'ofapi_client_transactions' AND column_name = 'type';
