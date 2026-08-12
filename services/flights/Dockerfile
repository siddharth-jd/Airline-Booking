# Pinned to the same major version the project was developed against. Not
# `node:24` and certainly not `node:latest` — an image tag that moves under you
# is the same class of problem as an unpinned database version.
FROM node:24-alpine AS base

WORKDIR /app

# COPY the manifests BEFORE the source, as a separate layer.
#
# Docker caches each instruction and reuses the cache until an input changes.
# Dependencies change rarely; source changes constantly. Copying package files
# first means editing a route does not invalidate the install layer, so a
# rebuild reuses the installed modules instead of redownloading them.
COPY package.json package-lock.json ./


# -----------------------------------------------------------------------------
# migrator — a one-shot image that applies schema migrations, then exits.
#
# This is a SEPARATE stage because migrations must not run as part of
# application startup. With more than one replica, several containers would
# race to apply the same migration on boot; and a schema change is a deliberate,
# reviewable operation, not a side effect of a deploy restarting a process.
#
# It keeps devDependencies because sequelize-cli lives there.
# -----------------------------------------------------------------------------
FROM base AS migrator

# `npm ci` rather than `npm install`: it installs exactly what the lockfile pins
# and fails if package.json and the lockfile disagree, instead of quietly
# resolving new versions. Reproducibility is the point of building an image.
RUN npm ci

COPY . .
USER node

# Apply migrations, then seed. Seeding is tracked in a SequelizeData table
# (seederStorage in config/config.js), so running it on every start is
# idempotent — already-applied seeders are skipped rather than re-inserted.
#
# Without this a fresh clone comes up with a correct but EMPTY schema: no
# airports, no flights, no seats, and a demo that shows nothing.
CMD ["sh", "-c", "npx sequelize-cli db:migrate && npx sequelize-cli db:seed:all"]


# -----------------------------------------------------------------------------
# runtime — what actually serves traffic.
#
# --omit=dev drops devDependencies: sequelize-cli and nodemon have no business
# in a production image. Less installed means less to audit and less to exploit.
# -----------------------------------------------------------------------------
FROM base AS runtime

RUN npm ci --omit=dev

COPY . .

# Run as a non-root user. The node image ships an unprivileged `node` user for
# exactly this. A process running as root inside a container that escapes its
# isolation is root on the host; an unprivileged one is not.
USER node

EXPOSE 4002

CMD ["node", "src/index.js"]