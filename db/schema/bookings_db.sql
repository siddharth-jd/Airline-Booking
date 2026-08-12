--
-- PostgreSQL database dump
--

\restrict MUMCnqzRDbAXE0mvqUo95vIYfcnxDYsYy4jdKqLwGq0Zv2cHIfQHQqEF3bFMSDb

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
-- Name: booking_seats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_seats (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    flight_seat_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone
);


--
-- Name: booking_seats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.booking_seats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_seats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.booking_seats_id_seq OWNED BY public.booking_seats.id;


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    flight_id bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    total_price_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bookings_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bookings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bookings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bookings_id_seq OWNED BY public.bookings.id;


--
-- Name: flight_seats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_seats (
    id bigint NOT NULL,
    flight_id bigint NOT NULL,
    seat_number text NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT flight_seats_status_valid CHECK ((status = ANY (ARRAY['available'::text, 'held'::text, 'booked'::text])))
);


--
-- Name: flight_seats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.flight_seats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: flight_seats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.flight_seats_id_seq OWNED BY public.flight_seats.id;


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    key text NOT NULL,
    user_id bigint NOT NULL,
    request_fingerprint text NOT NULL,
    booking_id bigint,
    status text DEFAULT 'in_progress'::text NOT NULL,
    response_status integer,
    response_body jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT idempotency_keys_status_valid CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    id bigint NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id bigint NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone
);


--
-- Name: outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outbox_id_seq OWNED BY public.outbox.id;


--
-- Name: booking_seats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_seats ALTER COLUMN id SET DEFAULT nextval('public.booking_seats_id_seq'::regclass);


--
-- Name: bookings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings ALTER COLUMN id SET DEFAULT nextval('public.bookings_id_seq'::regclass);


--
-- Name: flight_seats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_seats ALTER COLUMN id SET DEFAULT nextval('public.flight_seats_id_seq'::regclass);


--
-- Name: outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox ALTER COLUMN id SET DEFAULT nextval('public.outbox_id_seq'::regclass);


--
-- Name: SequelizeMeta SequelizeMeta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SequelizeMeta"
    ADD CONSTRAINT "SequelizeMeta_pkey" PRIMARY KEY (name);


--
-- Name: booking_seats booking_seats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_seats
    ADD CONSTRAINT booking_seats_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: flight_seats flight_seats_flight_id_seat_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_seats
    ADD CONSTRAINT flight_seats_flight_id_seat_number_key UNIQUE (flight_id, seat_number);


--
-- Name: flight_seats flight_seats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_seats
    ADD CONSTRAINT flight_seats_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: idx_booking_seats_active_seat; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_booking_seats_active_seat ON public.booking_seats USING btree (flight_seat_id) WHERE (cancelled_at IS NULL);


--
-- Name: idx_bookings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_user ON public.bookings USING btree (user_id);


--
-- Name: idx_flight_seats_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_seats_flight ON public.flight_seats USING btree (flight_id);


--
-- Name: idx_outbox_unpublished; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_unpublished ON public.outbox USING btree (created_at) WHERE (published_at IS NULL);


--
-- Name: booking_seats booking_seats_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_seats
    ADD CONSTRAINT booking_seats_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: booking_seats booking_seats_flight_seat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_seats
    ADD CONSTRAINT booking_seats_flight_seat_id_fkey FOREIGN KEY (flight_seat_id) REFERENCES public.flight_seats(id);


--
-- Name: idempotency_keys idempotency_keys_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- PostgreSQL database dump complete
--

\unrestrict MUMCnqzRDbAXE0mvqUo95vIYfcnxDYsYy4jdKqLwGq0Zv2cHIfQHQqEF3bFMSDb

