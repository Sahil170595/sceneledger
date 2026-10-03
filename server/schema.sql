CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE canvases (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    owner_id   UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE canvas_members (
    canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (canvas_id, user_id)
);

CREATE TABLE shapes (
    id           UUID PRIMARY KEY,
    canvas_id    UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    type         TEXT NOT NULL,
    x            DOUBLE PRECISION NOT NULL DEFAULT 0,
    y            DOUBLE PRECISION NOT NULL DEFAULT 0,
    width        DOUBLE PRECISION NOT NULL DEFAULT 0,
    height       DOUBLE PRECISION NOT NULL DEFAULT 0,
    fill         TEXT NOT NULL DEFAULT '',
    stroke       TEXT NOT NULL DEFAULT '#000000',
    stroke_width DOUBLE PRECISION NOT NULL DEFAULT 2,
    text         TEXT,
    font_size    DOUBLE PRECISION,
    opacity      DOUBLE PRECISION NOT NULL DEFAULT 1,
    border_radius DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shapes_canvas ON shapes(canvas_id);
CREATE INDEX idx_canvas_members_user ON canvas_members(user_id);
