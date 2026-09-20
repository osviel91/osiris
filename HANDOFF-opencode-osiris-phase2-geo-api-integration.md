# Handoff — Phase 2: OSIRIS ↔ Geo API Integration + Fork + CI/CD + Portainer

## Context

The homelab baseline is already working:

- OSIRIS is running successfully on a ZimaBoard under ZimaOS/Docker.
- `osiris-geo-api` is already implemented, published and deployed through GitHub → GHCR → Portainer.
- The Geo API is healthy and exposes at least:
  - `GET /health`
  - `GET /layers`
  - `GET /layers/test`
- Runtime impact on the ZimaBoard is low enough to proceed.
- The next objective is to make OSIRIS consume the Geo API and render our own GeoJSON layers on the map.

The key architectural rule for this phase:

> **OSIRIS must know about the Geo API, not about individual upstream data sources.**

Future integrations such as Home Assistant, AEMET, DMR repeaters, traffic, sensors or homelab state should normally be implemented in `osiris-geo-api`, not directly inside OSIRIS.

---

# Primary objective

Create and maintain a fork of:

`https://github.com/simplifaisoul/osiris`

under the user's GitHub account, expected target:

`osviel91/osiris`

Then implement a **minimal, isolated and upstream-friendly integration** that:

1. Discovers custom layers from `osiris-geo-api`.
2. Shows those layers in the OSIRIS layer UI under a clearly separate group such as `LOCAL DATA`.
3. Fetches the selected layer as GeoJSON.
4. Renders it in `OsirisMap`.
5. Supports enable/disable without reload.
6. Handles Geo API outages gracefully.
7. Keeps the change surface small so upstream synchronization remains practical.
8. Builds and publishes a custom Docker image to GHCR.
9. Deploys the fork through Portainer on the ZimaBoard using GitHub CI/CD.

Do **not** implement Home Assistant, PostGIS, DMR, AEMET, historical storage, MCP or Hermes integration in this phase.

---

# Current upstream observations

Current OSIRIS is a Next.js App Router application using:

- Next.js 16.x
- React 19.x
- TypeScript
- MapLibre GL
- `src/app/page.tsx` as the main dashboard/state orchestration layer
- `src/components/OsirisMap.tsx` as the central MapLibre rendering component
- `src/components/LayerPanel.tsx` for layer controls
- many server-side API routes under `src/app/api`
- Docker standalone build with Node 22 Alpine
- multi-arch GHCR images
- existing support for runtime map layers and GeoJSON-style data

The integration should follow the repository's existing patterns rather than introduce a parallel frontend framework.

Before coding, inspect the current upstream branch and actual component interfaces. Do not assume line numbers or exact prop shapes from this document.

---

# Desired architecture

```text
                    OSIRIS fork
                         │
                         │  GET /api/local-layers
                         ▼
                OSIRIS server route
                         │
                         │  HTTP
                         ▼
                  osiris-geo-api
                    ├── /health
                    ├── /layers
                    └── /layers/{id}
                         │
                         ▼
                    GeoJSON data
                         │
                         ▼
                    OsirisMap
```

Prefer a server-side proxy route inside OSIRIS rather than allowing the browser to call the Geo API directly.

Reasons:

- avoids CORS coupling;
- keeps the Geo API LAN URL out of browser-side configuration;
- gives OSIRIS one place for timeout/error handling;
- keeps future auth possible;
- lets the public/browser-facing API remain same-origin.

Target flow:

```text
Browser
  │
  ├── GET /api/local-layers
  │        │
  │        └── OSIRIS server → GEO_API_URL/layers
  │
  └── GET /api/local-layers/{id}
           │
           └── OSIRIS server → GEO_API_URL/layers/{id}
```

---

# Configuration

Add server-side configuration through environment variables.

Required:

```text
GEO_API_URL=http://osiris-geo-api:8000
```

Optional:

```text
GEO_API_ENABLED=true
GEO_API_TIMEOUT_MS=5000
```

Rules:

- Never hard-code the ZimaBoard IP.
- Never expose secrets through `NEXT_PUBLIC_*`.
- Prefer Docker network DNS (`http://osiris-geo-api:8000`) when OSIRIS and Geo API share a Docker network.
- If they are separate Portainer stacks, connect both to a common external Docker network.
- If shared-network deployment is not immediately practical, allow a LAN URL through environment configuration, but keep it server-side.
- Missing/unreachable Geo API must not prevent OSIRIS from starting.

Update `.env.example` and deployment docs.

---

# Docker networking

Preferred production layout:

```text
external network: osiris-platform
        │
        ├── osiris
        └── osiris-geo-api
```

If the Geo API stack does not already attach to a shared external network, update its deployment repository only if needed and only with a backwards-compatible change.

Suggested Compose pattern:

```yaml
networks:
  osiris-platform:
    external: true
```

OSIRIS service:

```yaml
services:
  osiris:
    networks:
      - osiris-platform
```

Geo API service:

```yaml
services:
  geo-api:
    networks:
      - osiris-platform
```

Then:

```text
GEO_API_URL=http://osiris-geo-api:8000
```

Do not expose additional host ports merely for container-to-container communication if the shared network solves the requirement.

Do not remove the existing host port if it is still useful for diagnostics.

---

# API adapter inside OSIRIS

Create a small integration module rather than scattering fetch logic through `page.tsx`.

Suggested structure:

```text
src/
  lib/
    geo-api/
      client.ts
      types.ts
      sanitize.ts   # only if needed
  app/
    api/
      local-layers/
        route.ts
        [id]/
          route.ts
```

Exact naming may differ if a better fit exists in the codebase.

## `client.ts`

Responsibilities:

- read `GEO_API_URL`;
- validate URL/configuration;
- request `/layers`;
- request `/layers/{id}`;
- enforce timeout;
- convert network failures into controlled errors;
- do not leak internal stack traces to the browser;
- optionally provide a small cache if existing OSIRIS patterns justify it.

Keep it lightweight.

## `types.ts`

Mirror only the contract actually required from `osiris-geo-api`.

Example conceptual metadata:

```ts
export interface LocalLayerMetadata {
  id: string;
  name: string;
  description?: string;
  endpoint?: string;
}
```

Do not create a huge speculative domain model.

## Server routes

### `GET /api/local-layers`

Expected behavior:

- if integration disabled: return a safe disabled/empty response;
- if Geo API healthy: proxy/normalize `/layers`;
- if Geo API unreachable: return controlled status/error and let the UI degrade gracefully;
- use a timeout;
- no unbounded retries.

### `GET /api/local-layers/[id]`

Expected behavior:

- validate layer id before forwarding;
- do not allow arbitrary URL/path injection;
- fetch only from configured Geo API;
- return valid GeoJSON payload;
- preserve appropriate content type;
- return controlled upstream error status.

---

# GeoJSON validation and MapLibre safety

Do not blindly feed arbitrary JSON into MapLibre.

At minimum validate:

```text
type == "FeatureCollection"
features is an array
each feature.type == "Feature"
geometry exists
supported geometry types are explicit
properties is object-like
```

For Phase 2, supporting `Point` is sufficient if `/layers/test` only emits points.

However, design the adapter so `LineString` and `Polygon` can be added later without architectural rework.

Important MapLibre defensive rule:

- normalize or reject values in `properties` that MapLibre/geojson-vt cannot safely serialize;
- `undefined`, nested objects, arrays and problematic `null` values should not reach a source unexamined;
- prefer primitive values (`string | number | boolean`) or safe string conversion where required.

Do not silently invent telemetry values.

---

# Frontend state model

Avoid adding one hard-coded boolean per local layer.

The local layers are dynamic and must be discoverable.

Prefer something conceptually similar to:

```ts
type LocalLayerState = {
  metadata: LocalLayerMetadata;
  enabled: boolean;
  loading: boolean;
  error?: string;
  geojson?: FeatureCollection;
};
```

Or a map keyed by layer id:

```ts
Record<string, LocalLayerState>
```

Desired lifecycle:

```text
page mount
   ↓
GET /api/local-layers
   ↓
metadata list
   ↓
render toggles
   ↓
user enables layer
   ↓
GET /api/local-layers/{id}
   ↓
validate/sanitize
   ↓
OsirisMap renders source
```

Fetch layer contents lazily when the layer is first enabled.

Do not download every future local dataset at initial page load.

Optional:

- cache fetched GeoJSON in client state;
- allow a manual refresh later.

Do not implement continuous polling unless the current test layer requires it. Live refresh belongs in a later phase.

---

# Layer UI

Add a clearly separate section to the existing OSIRIS layer panel:

```text
LOCAL DATA
  ○ Test Layer
```

Requirements:

- preserve existing visual style;
- do not redesign LayerPanel;
- display loading state;
- display a compact error indicator if a layer cannot load;
- toggling off removes/hides the layer without affecting upstream layers;
- dynamic layers returned by `/layers` should appear without another code change.

Do not hard-code:

```text
test: false
```

inside the main global list if a dynamic collection can avoid it.

The exact integration point must be chosen after inspecting `LayerPanel.tsx`.

---

# Map rendering

Add custom-layer rendering to `OsirisMap.tsx` with the smallest reasonable surface area.

Preferred approach:

- one GeoJSON source per local layer, or
- a managed collection if that matches current OSIRIS patterns better.

Source IDs must be namespaced, e.g.:

```text
local-data-test
```

Avoid collisions with upstream source/layer IDs.

For Point features, render a generic but recognizable marker.

Phase 2 styling requirements:

- visually distinct from core OSIRIS feeds;
- sensible default marker size;
- feature name visible in popup or click detail;
- display selected primitive properties;
- do not trust arbitrary HTML from feature properties;
- no `dangerouslySetInnerHTML`.

The style should not encode a specific future data source.

For example, a generic local-data marker is preferable to a Home Assistant icon in this phase.

---

# Feature interaction

Clicking a local feature should expose useful data.

Minimum:

```text
name
category
source
status
```

when present.

Also allow unknown primitive properties to be shown safely if that fits the existing popup system.

Do not create a completely separate modal framework if the existing map already has a popup/detail pattern that can be reused.

---

# Failure behavior

This integration is optional infrastructure.

OSIRIS core must still function when:

- `GEO_API_URL` is missing;
- Geo API is stopped;
- request times out;
- `/layers` returns malformed JSON;
- one individual layer returns malformed GeoJSON.

Expected UX:

```text
Core OSIRIS layers: continue working
LOCAL DATA section: unavailable/error indication
Application: no crash
```

Do not create automatic tight retry loops.

---

# Upstream-friendly fork strategy

The fork must retain a clean relationship with:

`https://github.com/simplifaisoul/osiris`

Set remotes conceptually as:

```bash
origin   git@github.com:osviel91/osiris.git
upstream https://github.com/simplifaisoul/osiris.git
```

Default branch may remain `master` if upstream uses `master`.

Before implementation:

```bash
git fetch upstream
git status
git log --oneline --decorate -n 10
```

Create an integration branch, e.g.:

```text
feature/local-geo-api
```

Do not develop directly on a stale fork branch.

Keep commits logically separated, for example:

```text
feat(geo-api): add server-side local layer adapter
feat(map): render dynamic local GeoJSON layers
feat(ui): expose local data layer controls
chore(docker): configure geo api integration
ci: publish custom osiris image
docs: document fork deployment and upstream sync
```

Avoid drive-by refactors.

---

# Upstream sync procedure

Document this explicitly in the fork README or `docs/UPSTREAM.md`.

Suggested workflow:

```bash
git fetch upstream
git checkout master
git merge --ff-only upstream/master
git push origin master
```

If the fork contains commits directly on master and fast-forward is impossible, choose a clean documented merge/rebase strategy rather than force-pushing casually.

Recommended long-term model:

```text
upstream/master
      │
      ▼
origin/master       # regularly synced baseline
      │
      ▼
feature/custom-*    # isolated changes / PRs
```

If operational simplicity requires the deployed fork customizations on `master`, document exactly how upstream merges are handled.

Never rewrite published history unless explicitly approved.

---

# Testing

Use the repository's existing test framework (Vitest).

Add tests for the integration.

Minimum server/client tests:

1. Geo API disabled/missing config does not crash.
2. `/api/local-layers` returns a normalized layer list.
3. upstream timeout is handled.
4. malformed `/layers` response is rejected safely.
5. valid FeatureCollection is accepted.
6. malformed FeatureCollection is rejected.
7. unsafe/non-primitive feature properties are normalized or rejected according to the chosen sanitizer contract.
8. layer-id path validation prevents arbitrary proxying.

Frontend/component tests where practical:

9. `LOCAL DATA` renders discovered layer metadata.
10. enabling a layer requests its GeoJSON.
11. disabling a layer hides/removes it.
12. failed custom layer does not break core layer rendering.

Do not make tests dependent on the live ZimaBoard Geo API.

Use mocks/fixtures.

Optional live integration tests may exist behind an explicit environment flag.

---

# CI

Use GitHub Actions in the fork.

At minimum:

## `.github/workflows/ci.yml`

Triggers:

- pull requests
- pushes to the deployment branch (`master` unless chosen otherwise)

Steps should match upstream package tooling:

```text
checkout
setup Node
npm ci
npm run lint
npm test
npm run build
```

Use the Node version compatible with the current Dockerfile/upstream setup; Node 22 is currently the expected baseline.

The build should run with a safe dummy/disabled Geo API configuration so CI does not need LAN access.

Example:

```text
GEO_API_ENABLED=false
```

CI must not call the homelab.

---

# Docker image publishing

Publish the customized fork image separately from upstream.

Expected image:

```text
ghcr.io/osviel91/osiris:latest
```

Also publish immutable SHA tags.

Recommended:

```text
latest
sha-<commit>
```

Optional semantic release tags later.

Build for:

```text
linux/amd64
```

required for ZimaBoard.

Publish `linux/arm64` too if the upstream Dockerfile/buildx flow supports it without complication.

Use GitHub Actions and `GITHUB_TOKEN` with least privilege:

```yaml
permissions:
  contents: read
  packages: write
```

Do not store registry credentials in the repository.

---

# Deployment Compose

Create a dedicated deployment file in the fork, e.g.:

```text
deploy/compose.yml
```

Do not blindly copy upstream's full compose if it includes services that are not part of the current homelab deployment.

Target minimal OSIRIS service:

```yaml
services:
  osiris:
    image: ghcr.io/osviel91/osiris:latest
    container_name: osiris
    restart: unless-stopped

    ports:
      - "${OSIRIS_PORT:-3005}:3000"

    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
      NODE_OPTIONS: --dns-result-order=ipv4first

      GEO_API_ENABLED: "true"
      GEO_API_URL: "http://osiris-geo-api:8000"
      GEO_API_TIMEOUT_MS: "5000"

    networks:
      - osiris-platform

networks:
  osiris-platform:
    external: true
```

Preserve any OSIRIS API-key environment variables actually required by the user's existing deployment.

Do not accidentally remove working configuration.

Before replacing the running stack, inspect/export the existing container/stack environment and compose configuration.

---

# Portainer migration plan

The currently working upstream OSIRIS deployment must not be destroyed until the custom image is verified.

Use a low-risk migration.

Recommended sequence:

1. Inspect existing OSIRIS Portainer stack.
2. Record:
   - image;
   - port mapping;
   - environment variables;
   - API keys;
   - networks;
   - restart policy;
   - volumes;
   - hostnames/aliases.
3. Create external network `osiris-platform` if absent.
4. Attach `osiris-geo-api` to it.
5. Verify from a disposable/container shell that:

```text
http://osiris-geo-api:8000/health
```

is reachable on that network.
6. Deploy custom OSIRIS fork **in parallel on a temporary host port**, e.g.:

```text
3006:3000
```

7. Validate:
   - base map;
   - existing OSIRIS layers;
   - `/api/local-layers`;
   - `LOCAL DATA`;
   - test points;
   - browser console;
   - server logs.
8. Only after validation, switch the production mapping from old OSIRIS to the fork.
9. Keep rollback information for the upstream image.
10. Remove the temporary/old deployment only after stable verification.

Do not reuse the same container name during parallel validation if that causes a collision.

---

# Rollback

Rollback must be trivial.

Record the last known working upstream image reference, ideally immutable digest or tag.

If the custom deployment fails:

```text
stop custom fork
restore previous upstream image/stack
```

The Geo API can remain deployed because core OSIRIS does not depend on it.

Document rollback in README/deployment docs.

---

# CD / Portainer

Reuse the same philosophy already established for `osiris-geo-api`.

Preferred:

```text
GitHub
  ↓
CI
  ↓
GHCR custom image
  ↓
Portainer GitOps/webhook/redeploy
  ↓
ZimaBoard
```

Do not assume unsupported Portainer features.

If a Portainer webhook is available:

- keep it in GitHub Secrets;
- trigger only after successful image publish;
- make the deploy step fail visibly if the webhook call fails.

If the current Portainer environment uses Git polling or manual redeploy, preserve that mechanism rather than inventing a new privileged path.

Do not expose Docker socket remotely.

---

# README / docs updates

Document:

- why the fork exists;
- upstream repository URL;
- Geo API integration architecture;
- environment variables;
- shared Docker network;
- local development;
- tests;
- Docker build;
- Portainer deployment;
- CI/CD;
- upstream synchronization;
- rollback;
- troubleshooting.

Suggested troubleshooting section:

```text
LOCAL DATA absent
  → check GEO_API_ENABLED
  → check GEO_API_URL

LOCAL DATA visible but layer fails
  → check /api/local-layers/{id}
  → check Geo API logs
  → validate GeoJSON

Geo API works from host but not OSIRIS
  → inspect Docker network
  → resolve osiris-geo-api DNS from OSIRIS container

Core OSIRIS broken after fork deployment
  → rollback immediately
  → compare environment with prior upstream stack
```

---

# Security requirements

- Geo API URL remains server-side.
- No private home coordinates in the OSIRIS repository.
- No secrets committed.
- No arbitrary proxy endpoint accepting caller-supplied URLs.
- Validate layer IDs.
- Sanitize popup/property rendering.
- No `dangerouslySetInnerHTML` for GeoJSON properties.
- No privileged Docker mode.
- No Docker socket mount.
- GitHub Actions use least privilege.
- Preserve upstream non-root container behavior.

---

# Performance requirements

The ZimaBoard currently handles OSIRIS comfortably. Do not regress that unnecessarily.

Rules:

- lazy-fetch local layer contents;
- no constant polling in this phase;
- do not clone the entire FeatureCollection on every React render;
- avoid putting very large GeoJSON objects into URL state;
- do not log complete large GeoJSON payloads;
- MapLibre sources should update only when layer data actually changes;
- disable/hide should not require refetch unless the cache has been intentionally invalidated.

For the test layer, resource usage should be negligible.

---

# Non-goals for Phase 2

Do not implement:

- Postgres/PostGIS;
- historical event storage;
- Home Assistant adapter;
- AEMET;
- DMR/repeater ingestion;
- traffic ingestion;
- alert engine;
- automatic correlation;
- Hermes/MCP;
- AI analysis;
- authentication platform;
- generic arbitrary URL import;
- user uploads;
- data editing;
- continuous real-time refresh framework.

Those belong to later phases.

---

# Definition of Done

Phase 2 is complete only when all of the following are true:

1. `osviel91/osiris` fork exists.
2. `upstream` remote is configured/documented.
3. Fork starts from current upstream code.
4. Geo API integration is isolated behind a small adapter.
5. `GEO_API_URL` is configurable server-side.
6. OSIRIS exposes a same-origin local-layer API/proxy.
7. `/layers` metadata is dynamically discovered.
8. `LOCAL DATA` appears in the layer UI.
9. `/layers/test` can be enabled interactively.
10. Test GeoJSON points render on the map.
11. Clicking a point shows safe feature metadata.
12. Toggling the layer off removes/hides it.
13. Geo API outage does not crash OSIRIS.
14. Existing OSIRIS layers still work.
15. Existing base map still works.
16. Unit/integration tests pass.
17. ESLint passes.
18. Next.js production build passes.
19. Docker image builds.
20. GHCR publishes `ghcr.io/osviel91/osiris`.
21. Custom image is deployed through Portainer.
22. Deployment uses the shared Docker network if feasible.
23. Fork is first validated on a temporary port.
24. Production cutover succeeds.
25. Rollback procedure is documented and tested conceptually.
26. No secrets or private coordinates appear in Git history.
27. README/docs explain upstream sync.
28. Final commit SHA and deployed image tag are reported.

---

# Expected final report from OpenCode

At completion, report concisely:

```text
Fork:
Branch:
Latest commit:
Upstream base commit:

CI:
Tests:
Build:

GHCR image:
Immutable image tag/digest:

Geo API URL used internally:
Docker network:

Portainer:
Temporary validation port:
Production port:
Deployment status:

Functional verification:
- base map:
- upstream layers:
- LOCAL DATA discovery:
- test layer:
- popup:
- Geo API outage behavior:

Rollback:
Upstream image/reference preserved:

Remaining issues / next phase:
```

---

# Agent operating instructions

Work incrementally.

Before making changes:

1. inspect current repository;
2. inspect current upstream;
3. inspect the existing Portainer deployment before replacing anything;
4. verify the already deployed Geo API contract.

Follow the operational rule:

> **Read/inspect first, modify second.**

Do not destroy or recreate unrelated stacks.

Do not change `osiris-geo-api` unless required for shared networking or a contract defect.

If a manual user action is required in GitHub or Portainer, stop at that exact boundary and provide one precise step. Continue once the user confirms it.

Do not claim success until the browser-facing behavior has been verified.

Prefer small commits and test after each meaningful change.

If an upstream OSIRIS mechanism already solves part of this integration cleanly, reuse it rather than duplicating it.

Avoid speculative refactors.

---

# Suggested next phase after this handoff

Once Phase 2 is stable, Phase 3 should add the **first real data adapter** to `osiris-geo-api`.

A good first candidate should satisfy:

- public or local source;
- useful geospatial data;
- easy validation;
- no large infrastructure dependency;
- visible value on the map.

Potential candidates:

1. AEMET / weather warnings or stations.
2. DMR repeaters.
3. Air-quality stations.
4. Madrid/Spanish public transport or traffic events.
5. Home Assistant entities that have meaningful location data.

The key principle remains:

```text
new source
   ↓
osiris-geo-api adapter
   ↓
stable GeoJSON contract
   ↓
OSIRIS renders dynamically
```

No additional OSIRIS code should be required for each new source once this phase is implemented.
