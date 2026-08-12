-- =============================================================================
-- A sandbox database for learning SQL. NOT part of the application.
--
-- This exists so SQL practice — following a course, trying things out, breaking
-- things on purpose — happens somewhere that cannot damage auth_db, flights_db
-- or bookings_db. The `practice` role has no access to any of those.
--
-- CREATEDB is granted so `CREATE DATABASE whatever;` works while following
-- along with a tutorial, which is one of the first things such a course does.
--
-- NOTE: `docker compose down -v` deletes the volume, so this script re-runs and
-- recreates an EMPTY practice_db. Any tables and data created while practising
-- are lost. Use plain `docker compose down` (no -v) to keep them.
-- =============================================================================

CREATE ROLE practice WITH LOGIN PASSWORD 'practice_pw' CREATEDB;

CREATE DATABASE practice_db OWNER practice;
