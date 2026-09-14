# Local Docker quality gates

The local quality runner mirrors the repository Quality job without requiring
Node, pnpm, or PostgreSQL on the host. It is separate from the production
images: `deploy/Dockerfile` and the School Dockerfiles retain their existing
package-manager and runtime boundaries.

Build the locked Node 24/pnpm 11.7.0 quality image:

```bash
docker compose -f docker-compose.quality.yml build quality
```

Run the full test gate with PostgreSQL 16:

```bash
docker compose -f docker-compose.quality.yml run --rm quality
```

Run the full build after tests:

```bash
docker compose -f docker-compose.quality.yml run --rm quality run build:full
```

Run an individual gate:

```bash
docker compose -f docker-compose.quality.yml run --rm quality run typecheck
docker compose -f docker-compose.quality.yml run --rm quality run test:postgres
docker compose -f docker-compose.quality.yml run --rm quality run test:refactoring
```

The PostgreSQL service is disposable (`tmpfs`). No production database, host
Docker socket, credentials, or package-manager cache is mounted into the
quality container. The host checkout is copied into the image at build time,
so rebuild the image after source changes.
