DO $$
BEGIN
  RAISE EXCEPTION
    'front office convergence rollback is intentionally blocked; restore the verified pre-migration sandbox backup';
END
$$;
