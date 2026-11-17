-- ENR-AUTH-01: enrollment withdrawal is administrator-only in PostgreSQL (provisional owner policy DEC-12, item 7).
-- Not a client-approved rule. No grant is seeded or modified; withdrawal still needs the separate
-- `enrollment.withdraw` project grant, project/geography scope and current `farmer.read`.
--
-- 1. The single enrollment authority refuses any non-administrator source for withdrawal, whatever grants exist.
--    Same body as migration 22 plus one rule; ownership and grants are preserved by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION operations.enrollment_permitted(p_project uuid,p_farmer uuid,p_permission text,p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE geography uuid;
BEGIN
  IF authz.actor() IS NULL OR p_project IS NULL OR p_farmer IS NULL OR p_permission IS NULL THEN RETURN false; END IF;
  IF p_permission NOT IN ('enrollment.read','enrollment.create','enrollment.withdraw') THEN RETURN false; END IF;
  -- Withdrawal is never available to a field-officer (or any other) source in v1.
  IF p_permission='enrollment.withdraw' AND p_source IS DISTINCT FROM 'administrator' THEN RETURN false; END IF;
  SELECT f.geography_id INTO geography FROM farm.farmer f WHERE f.id=p_farmer;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN authz.allowed_project_geography(p_project,geography,p_permission,p_source) IS NOT DISTINCT FROM true;
END $$;

-- 2. New grants can only be administrator-source for withdrawal. NOT VALID keeps the migration non-destructive:
--    a pre-existing field-officer withdraw grant (none is seeded) is never modified, and is inert because of (1).
ALTER TABLE authz.project_permission_grant ADD CONSTRAINT project_permission_grant_withdraw_admin_check
  CHECK(permission<>'enrollment.withdraw' OR registration_source='administrator') NOT VALID;
