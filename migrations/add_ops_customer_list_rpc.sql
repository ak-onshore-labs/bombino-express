-- Ops customer directory: filter-then-cap list + grouped order counts.
-- Service role only — these read customer rows and order volumes.

CREATE OR REPLACE FUNCTION public.ops_list_customers(
  p_q text DEFAULT NULL,
  p_account_type text DEFAULT NULL,
  p_kyc text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  full_name text,
  phone text,
  account_type text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text;
  v_compact text;
  v_pattern text;
  v_limit integer;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200);
  v_q := btrim(COALESCE(p_q, ''));
  v_compact := regexp_replace(v_q, '[\s-]', '', 'g');
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT u.id, u.full_name, u.phone, u.account_type, u.created_at
  FROM itd_users u
  WHERE u.role = 'customer'
    AND (
      p_account_type IS NULL
      OR p_account_type = ''
      OR u.account_type = p_account_type
    )
    AND (
      v_q = ''
      OR (v_compact ~ '^\d{10}$' AND u.phone = v_compact)
      OR (
        v_compact !~ '^\d{10}$'
        AND (
          u.full_name ILIKE v_pattern ESCAPE '\'
          OR u.phone ILIKE v_pattern ESCAPE '\'
        )
      )
    )
    AND (
      p_kyc IS NULL
      OR p_kyc = ''
      OR (
        p_kyc = 'on_file'
        AND (
          EXISTS (SELECT 1 FROM account_documents d WHERE d.user_id = u.id)
          OR EXISTS (SELECT 1 FROM kyc_documents k WHERE k.user_id = u.id)
          OR EXISTS (SELECT 1 FROM identity_verifications i WHERE i.user_id = u.id)
        )
      )
      OR (
        p_kyc = 'none'
        AND NOT EXISTS (SELECT 1 FROM account_documents d WHERE d.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM kyc_documents k WHERE k.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM identity_verifications i WHERE i.user_id = u.id)
      )
    )
  ORDER BY u.created_at DESC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_customer_order_counts(p_ids uuid[])
RETURNS TABLE (user_id uuid, order_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.user_id, count(*)::integer
  FROM orders o
  WHERE o.user_id = ANY (p_ids)
  GROUP BY o.user_id;
$$;

REVOKE ALL ON FUNCTION public.ops_list_customers(text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_list_customers(text, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.ops_list_customers(text, text, text, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.ops_customer_order_counts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_customer_order_counts(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.ops_customer_order_counts(uuid[]) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.ops_list_customers(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_customer_order_counts(uuid[]) TO service_role;

COMMENT ON FUNCTION public.ops_list_customers(text, text, text, integer) IS
  'Ops customer directory: search + account_type + KYC EXISTS, then newest 200 matches.';

COMMENT ON FUNCTION public.ops_customer_order_counts(uuid[]) IS
  'Grouped order counts for a page of registered customer ids. Null user_id (guests) excluded.';
