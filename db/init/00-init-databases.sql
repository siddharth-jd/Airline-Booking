-- =============================================================================
-- Creates one database and one login role per service.
--
-- Runs automatically the first time the Postgres container initialises an empty
-- data volume. To re-run it: `docker compose down -v` (the -v deletes the
-- volume) then `docker compose up -d`.
--
-- WHY SEPARATE DATABASES:
-- In microservices, a service owns its data. No other service may read its
-- tables directly — they must go through its API. This is not bureaucracy: the
-- moment two services share a table, changing that table requires coordinating a
-- deploy across both, and you have a distributed monolith, which carries every
-- cost of microservices and none of the benefits.
--
-- Separate databases plus separate roles enforce that at the permission level,
-- so the rule cannot be broken by accident. It is also what makes the "no
-- foreign key across services" constraint real rather than a promise — Postgres
-- physically cannot create an FK spanning two databases.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Login roles, one per service.
--
-- A ROLE in Postgres is both a user and a group; WITH LOGIN makes it usable as a
-- connection identity. Each service connects as its own role, so a bug or an
-- injection in one service cannot read another's data — the permission simply
-- is not there.
--
-- Passwords here are local-development values, committed deliberately so the
-- stack is reproducible with one command. Nothing in this file is a real secret.
-- -----------------------------------------------------------------------------
CREATE ROLE auth_svc     WITH LOGIN PASSWORD 'auth_dev_pw';
CREATE ROLE flights_svc  WITH LOGIN PASSWORD 'flights_dev_pw';
CREATE ROLE bookings_svc WITH LOGIN PASSWORD 'bookings_dev_pw';
CREATE ROLE notifications_svc WITH LOGIN PASSWORD 'notifications_dev_pw';


-- -----------------------------------------------------------------------------
-- One database per service, each owned by its own role.
--
-- OWNER matters: the owner can create tables, indexes and types inside its
-- database without further grants, which is what the migration scripts need.
-- -----------------------------------------------------------------------------
CREATE DATABASE auth_db     OWNER auth_svc;
CREATE DATABASE flights_db  OWNER flights_svc;
CREATE DATABASE bookings_db OWNER bookings_svc;
CREATE DATABASE notifications_db OWNER notifications_svc;


-- -----------------------------------------------------------------------------
-- Lock the doors.
--
-- PUBLIC is a special role that every role automatically belongs to. By default
-- Postgres grants PUBLIC the CONNECT privilege on new databases, which would let
-- auth_svc open a connection to bookings_db. Revoking it means each service can
-- reach only the database explicitly granted to it below.
--
-- The superuser `postgres` bypasses all of this — superusers ignore permission
-- checks — which is why we use it for administration and inspection but never as
-- an application's connection identity. A service running as superuser turns any
-- SQL injection into a total compromise of every database on the instance.
-- -----------------------------------------------------------------------------
REVOKE CONNECT ON DATABASE auth_db     FROM PUBLIC;
REVOKE CONNECT ON DATABASE flights_db  FROM PUBLIC;
REVOKE CONNECT ON DATABASE bookings_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE notifications_db FROM PUBLIC;

GRANT CONNECT ON DATABASE auth_db     TO auth_svc;
GRANT CONNECT ON DATABASE flights_db  TO flights_svc;
GRANT CONNECT ON DATABASE bookings_db TO bookings_svc;
GRANT CONNECT ON DATABASE notifications_db TO notifications_svc;
