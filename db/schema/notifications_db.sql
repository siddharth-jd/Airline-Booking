--
-- PostgreSQL database dump
--

\restrict o8DCepdUwbnekNxZHdJeqLL39STUEy0xZHEWAmtn5AEGyc4Dvah7MoSaw4BpkSb

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: SequelizeMeta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SequelizeMeta" (
    name character varying(255) NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    event_id text NOT NULL,
    user_id bigint NOT NULL,
    booking_id bigint NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT notifications_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: SequelizeMeta SequelizeMeta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SequelizeMeta"
    ADD CONSTRAINT "SequelizeMeta_pkey" PRIMARY KEY (name);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (event_id);


--
-- Name: idx_notifications_undelivered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_undelivered ON public.notifications USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- PostgreSQL database dump complete
--

\unrestrict o8DCepdUwbnekNxZHdJeqLL39STUEy0xZHEWAmtn5AEGyc4Dvah7MoSaw4BpkSb

