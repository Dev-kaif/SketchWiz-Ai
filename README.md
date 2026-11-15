# 🎨 SketchWiz – AI-Powered Collaborative Canvas

SketchWiz is a real-time, AI-enhanced collaborative canvas built using cutting-edge technologies. It allows users to **draw**, **write math/physics problems**, and get **instant AI assistance** — whether it's solving equations or enhancing their sketches. Think of it as an AI version of Excalidraw powered by Google Gemini AI, WebSockets, and a powerful room-based architecture.

---

# 📽️ Demo

[![Watch the demo](https://img.youtube.com/vi/UU-s-GS0FT8/hqdefault.jpg)](https://youtu.be/UU-s-GS0FT8)

---

## 🚀 Features

- 🔁 **Real-Time Collaboration**
  Join or create rooms using unique room names and collaborate with others. All drawings and interactions are **instantly synced** across all clients in the room using WebSockets.

- ✏️ **Infinite Canvas**
  A seamless, Excalidraw-style infinite canvas for freehand drawing, writing, and more.

- 🧠 **AI Assistance (Google Gemini)**

  - Solve **math** and **physics** problems drawn or written on the canvas.
  - Improve rough sketches with the help of AI-driven enhancements.

- 🏠 **Room-Based Architecture**

  - Create, join, or delete uniquely named rooms.
  - Each room stores its own canvas state and persists data, allowing users to pick up where they left off.

- 💾 **Persistent Drawing Storage**
  All drawings within a room are saved using PostgreSQL + Prisma, ensuring no data is lost when users leave or refresh.

---

## 🛠️ Tech Stack

### 🧩 Monorepo

- **Turborepo** – For organizing frontend, backend, and shared modules efficiently.

### 🎨 Frontend

- **Next.js** – React framework for SSR and performance
- **Tailwind CSS** – Utility-first styling
- **Framer Motion** – Smooth animations and transitions
- **WebSocket Client** – Real-time updates
- **Google Gemini API** – AI assistance and drawing understanding

### 🧠 Backend

- **Node.js** + **Express** – Scalable backend with REST & WebSocket handling
- **WebSockets (Socket.IO)** – Real-time room-based communication
- **Prisma ORM** – Type-safe database queries
- **PostgreSQL** – Persistent storage for canvas and room data

---

## 🔗 How It Works

1. **Create/Join Room:**
   Navigate to the app, enter a room name to create or join an existing one.

2. **Collaborate in Real-Time:**
   All participants see the canvas updates live.

3. **Draw or Write Equations:**
   Write problems directly on the canvas — Gemini AI will solve them or suggest improvements.

4. **Enhance Drawings:**
   Rough sketches? Let AI enhance them with a single click.

5. **Data Persistence:**
   Drawings remain saved in the room, accessible anytime.

---

## 📂 Folder Structure (Turborepo)

```
/apps
  /web        - Next.js frontend
  /server     - Node.js + Express backend

/packages
  /ui         - Shared UI components
  /config     - Shared config & types
```

---

## 🧪 Setup & Development

### Prerequisites

- Node.js (18+)
- PostgreSQL instance
- Gemini API Key

### 1. Clone the Repo

```bash
git clone https://github.com/your-username/sketchwiz.git
cd sketchwiz
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Environment Variables

Create `.env` files in `apps/server` and `apps/web` with:

```env
# Common
DATABASE_URL=postgresql://<username>:<password>@<host>:<port>/<db>

# Server
PORT=5000
GEMINI_API_KEY=your_api_key

# Web
NEXT_PUBLIC_API_URL=http://localhost:5000
```

### 4. Start Development

```bash
# In root
npm run dev
```

---

## 📸 Screenshots (Optional)

_Add visuals of canvas, AI solutions, and real-time collab here_

---

## 📌 Roadmap

- ✅ Drawing & writing on infinite canvas
- ✅ Real-time WebSocket sync
- ✅ AI-powered equation solving
- ✅ AI-powered sketch enhancement
- ✅ Persistent room data storage
- ⏳ Authentication & private rooms
- ⏳ Export canvas to image/PDF
- ⏳ Voice-to-math input

---

## Backend and API Reference

This section documents the backend implemented in `apps/server` and the realtime service in `apps/websocket`. Both are separate Node.js processes. They use Railway's `PORT` when set; local defaults are `5000` for HTTP and `8000` for WebSockets.

### Services and shared packages

- `apps/server/src/app.ts` creates the independently testable Express application. `src/index.ts` validates environment variables, connects to PostgreSQL, starts listening, and handles shutdown.
- `apps/server/src/modules/` contains authentication, room, and AI routes; shared error handling is in `src/middleware/`.
- `apps/websocket/src/server.ts` creates the WebSocket listener. Authentication, room membership, message parsing, persistence, and broadcasting are in separate modules.
- `packages/db` owns the canonical Prisma schema and migrations and exports one Prisma client singleton per service process. Prisma 7 uses the PostgreSQL driver adapter.
- `packages/common` provides Zod request and message schemas shared by both backend services.
- `packages/backend` validates service-specific environment variables and provides the structured logger.

### Environment variables

Set these on the service that uses them:

| Variable         | Used by                           | Purpose                                                                          |
| ---------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`   | HTTP server and WebSocket service | PostgreSQL connection string used by Prisma.                                     |
| `JWT_SECRET`     | HTTP server and WebSocket service | Signs and verifies authentication tokens. Both services must use the same value. |
| `GEMINI_API_KEY` | HTTP server                       | Authenticates Gemini API calls.                                                  |
| `PORT`           | Each deployed service             | Railway-provided port; defaults to `5000` (HTTP) or `8000` (WebSocket).          |
| `HOST`           | Each service                      | Listen host; defaults to `0.0.0.0`.                                              |
| `CORS_ORIGINS`   | HTTP server                       | Comma-separated allowed origins; defaults to `*` for compatibility.              |
| `NODE_ENV`       | Each service                      | `development`, `test`, or `production`; defaults to `development`.               |

The web app also needs `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_WS_URL` at build time; those are frontend settings, not server secrets. Set `CORS_ORIGINS` to the deployed frontend origin in production.

### Authentication

`POST /api/signin` returns a JWT on success. Send that token as either a raw `Authorization` value or as a Bearer token on protected HTTP endpoints, for example:

```http
Authorization: eyJhbGciOi...
```

The WebSocket client passes the same token as the `token` query parameter. Tokens are signed without an explicit expiry in the current implementation.

### HTTP endpoints

All routes are mounted at the root path shown below. JSON routes expect `Content-Type: application/json` unless otherwise noted.

#### `GET /api/ping`

Health check; no authentication or body required.

- `200`: plain text `pong`.

#### `POST /api/signup`

Creates a user. No authentication required.

Request JSON:

```json
{
  "email": "person@example.com",
  "username": "artist123",
  "name": "Example Artist",
  "password": "at-least-8-characters",
  "photo": "https://example.com/avatar.png"
}
```

`photo` is optional. The Zod schema requires a valid email, username and name of 3–30 characters, and a password of at least 8 characters. The password is hashed with bcrypt using 10 salt rounds before storage. The API does not return the created user.

- `201`: `{ "message": "User created successfully" }`
- `400`: invalid input, with Zod details in `errors`.
- `409`: duplicate email or username (as detected by the current error-message check).
- `500`: other database or server error.

#### `POST /api/signin`

Authenticates an existing user. No authentication required.

Request JSON:

```json
{ "email": "person@example.com", "password": "at-least-8-characters" }
```

The API validates input, looks up the user by email, compares the password with bcrypt, and signs a JWT containing `{ "id": user.id }` using `JWT_SECRET`.

- `200`: `{ "message": "Signin successful", "token": "..." }`
- `400`: invalid input, with Zod details in `errors`.
- `401`: unknown email or incorrect password; both return `Invalid credentials`.
- `500`: unexpected database or server error.

#### `POST /api/room` (protected)

Creates a room owned by the authenticated user. The request body is `{ "roomName": "my-room" }`; room names must be 3–30 characters. The authenticated user ID becomes `adminId`; an OWNER membership and empty canvas are created with the room.

- `200`: `{ "message": "Joined room", "room": { ... } }` (the implementation creates a room despite the message saying “Joined”).
- `400`: invalid room name.
- `403`: duplicate room slug.
- `401`: missing, invalid, or expired token.

#### `GET /api/rooms` (protected)

Lists rooms whose `adminId` matches the authenticated user. This is not a list of every room the user may have joined.

- `200`: `{ "rooms": [ ... ] }`
- `500`: database errors return a safe generic error response.
- `401`: missing, invalid, or expired token.

#### `GET /api/room/:roomId` (protected)

Returns up to 2,000 persisted chat rows in ID order for the numeric room ID as `{ "messages": [ ... ] }`. It does not currently check that the caller belongs to the room or owns it.

- `200`: `{ "messages": [ ... ] }`
- `500`: database errors return a safe generic error response.
- `401`: missing, invalid, or expired token.

#### `GET /api/room/slug/:slug` (protected)

Looks up one room by its slug and returns `{ "room": roomOrNull }`. It does not currently check room membership or ownership.

- `200`: room object or `null` in `room`.
- `500`: database errors return a safe generic error response.
- `401`: missing, invalid, or expired token.

#### `DELETE /api/room/delete/:roomId` (protected)

Deletes all chat rows for a room and then deletes the room in a Prisma transaction. The current implementation does not check that the authenticated user owns the room.

- `200`: success message and deleted `room` object.
- `500`: deletion or database error.
- `401`: missing, invalid, or expired token.

#### `DELETE /api/room/delete/content/:roomId` (protected)

Deletes chat, canvas element, operation, and snapshot rows for the specified room, leaving the room and its revision in place. The current implementation does not check ownership or membership.

- `200`: `{ "message": "Content deleted successfully.", "response": { ...deleteMany count... } }`
- `500`: deletion or database error.
- `401`: missing, invalid, or expired token.

#### `POST /api/analyze/ai` (multipart image upload)

Accepts `multipart/form-data` with an `image` file (maximum 10 MiB). The route sends it to Gemini for visual interpretation, then returns `{ "analysisResult": [...] }`. It uses `gemini-3.8-flash`, parses the model response as JSON, and returns a cleaned response if parsing fails. Although a `dictOfVars` field is mentioned in the prompt, it is not read from the request. The endpoint does not currently require authentication.

- `200`: `{ "analysisResult": [...] }`.
- `400`: `{ "error": "No image provided" }`.
- `500`: `{ "error": "Internal Server Error" }` if Gemini or processing fails.

#### `POST /api/improve/ai` (multipart image upload)

Accepts `multipart/form-data` with an `image` file (maximum 10 MiB). It asks Gemini to generate a more detailed prompt, then uses `gemini-3.1-flash-image` for an enhanced sketch. On success it returns image bytes with `Content-Type: image/png`. This endpoint does not currently require authentication.

- `200`: PNG image bytes.
- `400`: `{ "error": "No image provided" }`.
- `500`: `{ "error": "Internal Server Error" }` if AI generation or processing fails.

### WebSocket protocol

Connect to `ws://<host>:8000/?token=<JWT>` locally, or `wss://.../?token=<JWT>` in production. The server verifies the token during connection. Invalid or missing tokens are closed. Messages are JSON objects validated against the shared schema.

Client message types:

| Type         | Required fields     | Behavior                                                                                                                                                                                             |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `join_room`  | `roomId` number     | Adds this connection to the in-memory membership list for that room.                                                                                                                                 |
| `leave_room` | `roomId` number     | Removes this connection from that room.                                                                                                                                                              |
| `chat`       | `roomId`, `message` | In one transaction stores the legacy chat row and, for shape payloads, updates canvas state and creates an operation record. Then broadcasts `{ type, message, roomId }` to other connected members. |
| `ai`         | `roomId`, `message` | Broadcasts `{ type, message, roomId }` to all connected room members, including the sender. It does not persist the message.                                                                         |

Room membership exists only in the running process. The service has no explicit acknowledgement/error protocol and does not check whether a user may join a room. Malformed messages and asynchronous handler errors are logged without crashing the process. High-frequency drawing events are not logged.

### Backend functions and middleware

#### HTTP and WebSocket modules

- `apps/server/src/app.ts` creates the Express app without listening, allowing API tests to attach a temporary HTTP server.
- `apps/server/src/modules/auth/` validates sign-up/sign-in input, hashes passwords, verifies credentials, and signs JWTs.
- `apps/server/src/modules/rooms/` implements room creation/list/read/delete and compatibility history retrieval.
- `apps/server/src/modules/ai/` handles image uploads and Gemini requests.
- `apps/websocket/src/server.ts` owns connection lifecycle. `auth.ts`, `rooms.ts`, `messages.ts`, and `broadcast.ts` handle token checks, membership, validated messages and room broadcasts.
- `packages/db/src/index.ts` creates the per-process Prisma singleton through Prisma's PostgreSQL adapter; `disconnectDatabase` closes its pool during shutdown.
- The obsolete scheduled pinger was removed. Deployment health checks should use service health endpoints or platform health checks.

### Current implementation notes

Remaining concerns:

- Authentication confirms identity, but room reads/deletes and WebSocket joins do not verify membership or ownership.
- AI image endpoints are unauthenticated. Uploads are capped at 10 MiB, but a public caller can still consume Gemini spend and server memory.
- CORS defaults to `*` for compatibility; configure `CORS_ORIGINS` in production.
- The Gemini response parser falls back to a cleaned text value when JSON parsing fails; schema validation would make the contract safer.

### Batch 01 architecture update

The backend is being organized into small modules. These are implemented now:

```text
apps/server/src/
  app.ts                  Express app factory; safe to import in tests
  index.ts                Environment loading, listen, and shutdown
  errors.ts               Typed application error
  middleware/             Authentication and final HTTP error handler
  modules/auth/            Signup/signin routes, controllers, and service
  modules/rooms/           Room API routes and database calls
  modules/ai/              AI upload routes

apps/websocket/src/
  server.ts                WebSocket listener and process lifecycle
  auth.ts                  Token verification
  rooms.ts                 In-memory room membership
  messages.ts              Safe message parsing, persistence, dispatch
  broadcast.ts             Room broadcasts

packages/backend/src/
  env.ts                   Zod validation for service settings
  logger.ts                Small JSON structured logger
packages/common/src/
  schemas.ts               Shared HTTP and WebSocket input schemas
packages/db/
  prisma/schema.prisma     Canonical database schema
  prisma/migrations/       Canonical migration history
  scripts/                 Repeatable legacy canvas import
```

#### Database entities

```mermaid
erDiagram
  User ||--o{ Room : owns
  User ||--o{ RoomMember : joins
  Room ||--o{ RoomMember : contains
  Room ||--o| Canvas : has
  Canvas ||--o{ CanvasElement : contains
  Canvas ||--o{ CanvasOperation : records
  Canvas ||--o{ CanvasSnapshot : snapshots
  User ||--o{ Asset : owns
  Room ||--o{ Chat : legacy_compatibility
```

- `Room.adminId` remains the existing owner identifier, preserving existing room ownership and IDs. `RoomMember` adds unique per-room membership and owner/editor/viewer roles; existing owners are inserted as `OWNER` by the additive migration. Newly created rooms create their owner membership and empty canvas in the same database write.
- `Canvas` is the current canvas record for a room and carries the latest monotonically increasing revision.
- `CanvasElement` stores each shape's flexible properties as PostgreSQL JSONB. The WebSocket path currently dual-writes supported shape messages to this current-state table while continuing to write the legacy `Chat` row required by the existing frontend.
- `CanvasOperation` records those writes with a unique operation ID (`chat-<legacy row id>`) and per-canvas revision. The present protocol does not carry client operation IDs, so this compatibility ID prevents replay of the same persisted row but cannot deduplicate repeated client sends.
- `CanvasSnapshot` is modeled for future recovery. Snapshot creation and operation compaction are not implemented in this batch; adding them before defining the synchronization protocol would create ambiguous recovery rules.
- `Asset` stores object-storage metadata only (key, MIME type, size and optional checksum). Image bytes are not stored in canvas JSON or PostgreSQL by this schema; object storage integration is future work.
- `Chat` remains the compatibility/history table. No legacy rows are deleted by the new migration or backfill.

#### Persistence and synchronization strategy

The current source of truth for the legacy browser contract remains `Chat`: it returns the persisted JSON shape history to the frontend as before. The new current-state projection is `Canvas` plus `CanvasElement`; the WebSocket service writes both projections atomically, and writes a corresponding `CanvasOperation`. AI and drawing previews are not persisted by this change. Cursor, selection and presence events are not part of the current protocol.

Snapshots, compaction, incremental reconnect, and authoritative operation replay are intentionally deferred until the canvas protocol has stable operation IDs and explicit update/delete semantics. This avoids claiming recovery guarantees the existing protocol cannot provide.

#### Migration and rollback

All three original migration directories were byte-for-byte aligned. Their history is now retained once under `packages/db`; service-local Prisma copies have been removed. The new migration only adds membership/canvas/asset tables, indexes, enums and a `Room.visibility` column with a `PRIVATE` default. It also creates owner memberships and empty canvas rows for existing rooms. It does not change or delete existing users, passwords, room IDs, chat rows or room ownership.

After applying the additive migration to a **backup or local development database**, run `pnpm --filter @repo/db backfill:legacy-canvas`. The script uses deterministic element and operation IDs, skips existing imports, increases revisions transactionally, and prints migrated/skipped/unsupported/failed counts. Malformed, unsupported, and inline base64 image rows are retained in `Chat` and counted as unsupported; the script does not invent a canvas representation for them. Review the counts and sample canvas contents before switching readers. Do not run the backfill before the schema migration.

Rollback: stop the new app version and restore the pre-migration database backup if rollback is required. Do not roll back by dropping the new tables: live writes to those tables would be lost. Existing API reads continue using `Chat`, so an application rollback remains compatible with preserved legacy rows. The migration is additive, but removal of its schema objects requires a separately reviewed recovery plan.

#### Query and performance notes

- Room listing is filtered by `adminId`, which is already unique owner lookup access; membership uses a unique `(roomId,userId)` constraint and `(userId,roomId)` index.
- Room slug has an existing unique index; chat history lookup uses `roomId`, and now requests rows in ID order with a bounded page of 2,000 rows. The legacy API does not yet expose a cursor, so very large history needs a follow-up compatible paging contract.
- Canvas state has a unique room key; element, operation, and snapshot access are indexed by canvas and revision/time. Operation IDs are unique for duplicate prevention.
- Image uploads are held in memory and limited to 10 MiB. AI requests are synchronous from the HTTP caller's perspective and can consume substantial memory/latency. Large-scale jobs/queues are not introduced.
- WebSocket connection membership uses room-indexed sets. Database writes happen before chat broadcast and are transactionally paired with canvas projection writes.

#### Security follow-up

Room-level authorization remains critical follow-up work: the current HTTP room read/delete endpoints and WebSocket room joins still authenticate identity without checking room membership or ownership. AI upload endpoints remain unauthenticated, though uploads now have a size limit. CORS remains `*` by default for compatibility and should be restricted with `CORS_ORIGINS` when the frontend origin is finalized. JWTs remain compatible with raw-token `Authorization` headers and now also accept `Bearer` syntax; both services must use a 32-character-or-longer shared secret.

### Running backend packages locally

Use Node.js 26 and the pinned pnpm version from the repository root. The service `.env.example` files show local settings; Docker Compose exposes `postgres:latest` on `localhost:55432` with disposable storage. Prisma schema and migrations live only in `packages/db`.

```bash
pnpm install
pnpm build:server
pnpm build:websocket
```

Before running either service, configure its `.env` with `DATABASE_URL` and `JWT_SECRET`; the HTTP server also needs `GEMINI_API_KEY`. `@repo/db` generates its shared Prisma client as part of its build. Each service starts from its compiled `dist/index.js`.

### Batch 01.1 verification and performance baseline

Local checks completed on Node `v26.5.0`, macOS ARM64, with the disposable PostgreSQL container:

- Fresh database: all three migrations applied successfully; Prisma reports the schema up to date.
- Legacy fixture: additive migration remains up to date and existing fixture data is present (users, room, three Chat rows, owner membership, and canvas). The migration does not update passwords or delete legacy data.
- Backend integration tests: HTTP signup/signin/room/history/clear, WebSocket auth/room isolation/malformed message/concurrent drawing persistence, and repeatable legacy backfill all passed. Backfill imported 6 supported rows, counted 3 unsupported, and failed 0; a second run imported 0 and skipped 6.
- Backend TypeScript project build passed using the installed TypeScript 6 compiler. Server and WebSocket ESLint completed with no errors.
- Prisma 7 emits an explicit install warning that Node 26 is not among its listed supported Node versions (20.19+, 22.12+, 24+). The generated client and integration tests ran successfully under Node 26.5 here; deploy compatibility remains a separate check.
- `pnpm install` succeeds with the lockfile and approved native build scripts. The Turbo package-script build did not complete in this environment because pnpm repeatedly started dependency verification/install subprocesses; direct Prisma generation and the affected TypeScript project build succeeded.

The following measurements are a single local baseline, not a before/after comparison. They include application, Node, and local Docker overhead. Room API reads are capped at 2,000 rows, including the 10,000-row fixture. Percentiles for 15 or 20 samples are coarse; p99 often equals the maximum sample.

| Scenario                                | Samples |      p50 |      p95 |      p99 |     Throughput |
| --------------------------------------- | ------: | -------: | -------: | -------: | -------------: |
| HTTP `/api/ping`                        |     100 |  1.47 ms |  1.74 ms |  2.29 ms |      642 req/s |
| Chat insert                             |      30 |  0.61 ms |  1.51 ms |  3.28 ms | 1,275 writes/s |
| Full canvas persistence transaction     |      30 |  3.66 ms |  4.71 ms | 13.75 ms |      254 ops/s |
| Room read, 100 stored rows              |      15 |  2.85 ms | 11.33 ms | 11.33 ms |      295 req/s |
| Room read, 1,000 stored rows            |      15 |  4.19 ms |  6.40 ms |  6.40 ms |      224 req/s |
| Room read, 10,000 stored rows           |      15 |  5.40 ms |  7.34 ms |  7.34 ms |      178 req/s |
| WS connection setup, 1 client           |       1 |  3.11 ms |  3.11 ms |  3.11 ms |              — |
| WS connection setup, 10 clients         |      10 |  3.58 ms |  4.89 ms |  4.89 ms |              — |
| WS connection setup, 50 clients         |      50 | 16.66 ms | 23.16 ms | 23.62 ms |              — |
| WS broadcast, 1 client                  |      30 |  0.09 ms |  0.22 ms |  0.61 ms |    7,245 msg/s |
| WS broadcast, 10 clients                |      30 |  0.27 ms |  0.31 ms |  0.32 ms |    3,667 msg/s |
| WS broadcast, 50 clients                |      30 |  0.85 ms |  1.04 ms |  1.22 ms |    1,172 msg/s |
| Persisted chat to broadcast, 10 clients |      20 |  4.65 ms | 12.96 ms | 17.76 ms |              — |
| Persisted chat to broadcast, 50 clients |      20 |  4.62 ms |  6.36 ms |  7.66 ms |              — |

`EXPLAIN (ANALYZE, BUFFERS)` for the 10,000-row chat room returned 2,000 rows through `Chat_roomId_id_idx`; measured execution was 0.338 ms with 35 shared-buffer hits and no reads. The Node process peaked at about 254 MiB RSS during the benchmark, versus about 95 MiB at the start. It used about 1.21 CPU-seconds in user space and 0.10 CPU-seconds in system time during the run. These are local observations, not a production capacity claim. No equivalent pre-refactor benchmark was retained, so this does not prove a speedup.

Known bottlenecks and deferred work: legacy chat remains unbounded even though each response is limited to 2,000 rows; the endpoint has no cursor pagination. The backfill is row-transactional and may be slow for very large histories. Canvas operations grow without compaction; snapshots have no writer. Inline base64 image history remains in `Chat`, and there is no object storage integration. No load test with concurrent drawing workload across multiple simultaneously active rooms was run.

Latest frontend dependency upgrades also surfaced existing source/API compatibility errors in the web app (`lucide-react` social icon exports, Motion transition typing, and Tailwind 4 `darkMode` typing). Frontend source and canvas code are outside this batch and were not changed; the backend-focused checks above do not imply the web app type-checks.

---
