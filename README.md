<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=200&section=header&text=InboxIt&fontSize=80&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=Your%20Gmail.%20On%20Steroids.&descAlignY=55&descAlign=50" width="100%"/>

# 📬 InboxIt

### A production-grade, AI-ready Gmail client built for developers who actually ship things.

[![Live Demo](https://img.shields.io/badge/🚀%20Live%20Demo-inboxit.vercel.app-667eea?style=for-the-badge)](https://inboxit.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-Upstash-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://upstash.com)
[![BullMQ](https://img.shields.io/badge/BullMQ-Queue%20Engine-FF6B6B?style=for-the-badge)](https://docs.bullmq.io)

</div>

---

## 🤔 Why I built this

Gmail is chaos. Job alerts buried under food delivery notifications. Internship emails lost in promotional spam. Cab receipts, bank OTPs, LinkedIn pings — all flattened into one endless list.

InboxIt solves this. It connects to your Gmail, syncs your emails in the background using a **chunked BullMQ queue engine**, and automatically drops them into smart folders: **Jobs, Finance, Food, Cabs, Health, Social, Todo**. No manual filters. No sorting rules. Just open the app and your inbox is already organized.

Built entirely from scratch — no email SDK shortcuts, no pre-built inbox templates. Raw Gmail API, custom MIME parser, custom classifier, production-grade sync architecture.

---

## ✨ Features

| Feature | What it does |
|---|---|
| 🔐 **Google OAuth2** | One-click sign-in, JWT issued on login |
| ⚡ **Chunked Sync Engine** | Syncs 500 emails/chunk via BullMQ, fully resumable |
| 🔄 **Live Tracker** | Incremental sync every 60s via Gmail History API |
| 🗂️ **Smart Folders** | Auto-classifies into Jobs, Finance, Food, Cabs, Health, Social, Todo |
| ⚡ **Redis Caching** | Folder queries served in <50ms after first load |
| 📖 **Load More** | Lazy-load older emails on demand, never dumps your whole inbox at once |
| 🗑️ **Trash / Archive** | Syncs back to real Gmail — delete in InboxIt, gone in Gmail |
| 🔒 **Token Auto-Refresh** | Gmail OAuth token refreshed silently before every request |
| 🌐 **REST API** | Clean endpoints for list, detail, update, delete, archive |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Next.js)                          │
│         JWT over httpOnly cookie · SWR for data fetching         │
└──────────────────────┬──────────────────────────────────────────┘
                       │ REST (JWT)              ↕ socket.io (WIP)
┌──────────────────────▼──────────────────────────────────────────┐
│                      Express API Server                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ GET /emails  │  │ POST /sync   │  │ PATCH/DELETE /emails  │   │
│  │ Redis cache  │  │ BullMQ enqueue│  │ MongoDB + cache bust  │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────────┘   │
│         │                │                                        │
│  ┌──────▼──────┐  ┌──────▼──────────────────────────────────┐   │
│  │ MongoDB     │  │              BullMQ Worker                │   │
│  │ Atlas       │  │  1. Fetch 500 emails from Gmail API       │   │
│  │ (emails +   │  │  2. Parse MIME (custom parser)            │   │
│  │  users)     │  │  3. Classify → smart folder               │   │
│  └─────────────┘  │  4. Upsert into MongoDB (idempotent)      │   │
│                   │  5. Bust Redis cache                       │   │
│  ┌─────────────┐  │  6. Save nextPageToken (resumable)        │   │
│  │ Redis       │  │  7. Start 60s incremental tracker         │   │
│  │ (Upstash)   │  └─────────────────────────────────────────-┘   │
│  │ BullMQ qs   │                                                  │
│  │ Folder cache│                                                  │
│  └─────────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### The "Lazy Load + Live Track" Model

The sync engine works in two distinct phases:

**Phase 1 — Lazy Load (on first login)**
- POST `/sync` drops a job into BullMQ and returns `200 OK` immediately
- Worker downloads the 500 most recent emails from `INBOX`
- Parses, classifies, and upserts into MongoDB
- Saves `nextPageToken` for the "Load More" button
- Stops — doesn't dump your entire email history

**Phase 2 — Live Track (every 60 seconds after)**
- Worker enqueues a periodic `incremental` sync job
- Uses Gmail's `history.list` API with `lastHistoryId` as the cursor
- Downloads only new/changed emails since last check
- `0 new emails` = valid success state, not a panic trigger
- Keeps your inbox real-time without hammering the API

---

## 🗂️ Smart Folder Classification

The classifier runs on every email using sender domain + subject keyword matching:

| Folder | What goes here |
|---|---|
| 💼 **jobs** | Naukri, LinkedIn, Internshala, Wellfound, Cutshort, Instahyre, Hirist, Accenture, Freshers, Careers |
| 💰 **finance** | Banks, HDFC, SBI, Paytm, PhonePe, GPay, ICICI, mutual funds, statements |
| 🍔 **food** | Swiggy, Zomato, food delivery receipts |
| 🚕 **cabs** | Uber, Ola, Rapido, ride receipts |
| 🏥 **health** | Apollo, Practo, PharmEasy, 1MG, doctor, appointment |
| 👥 **social** | Facebook, Instagram, Twitter, WhatsApp, Reddit, LinkedIn social |
| ✅ **todo** | Reminders, bills due, action required, follow-up |
| 📥 **inbox** | Everything else, sorted by date |

---

## 🗃️ Data Models

<details>
<summary><strong>User Schema</strong></summary>

```js
{
  googleId, email, name, avatar,
  accessToken, refreshToken, tokenExpiry,
  lastHistoryId,      // cursor for incremental sync
  lastSyncedAt,
  nextPageToken,      // cursor for load-more
  totalSynced,
  isSyncing,          // distributed lock
  syncStartedAt       // auto-unlock after 10 min if stuck
}
```
</details>

<details>
<summary><strong>Email Schema</strong></summary>

```js
{
  userId,             // ref to User
  gmailMessageId,     // unique per user (compound index)
  threadId,
  from, to, subject, snippet,
  bodyHtml, bodyText,
  labels,             // native Gmail labels [INBOX, SENT, ...]
  categories,         // custom: ["jobs", "finance", ...]
  receivedAt,
  isRead, isStarred, isDeleted
}
```
</details>

---

## ⚙️ API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/google` | Redirect to Google OAuth |
| `GET` | `/auth/google/callback` | OAuth callback, issues JWT |

### Sync
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/sync` | Trigger full or incremental sync |
| `POST` | `/api/sync/load-more` | Resume next 500-email chunk |

### Emails
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/emails?folder=jobs&page=1` | List emails by smart folder |
| `GET` | `/api/emails/:id` | Full email with bodyHtml + bodyText |
| `PATCH` | `/api/emails/:id` | Update isRead, isStarred, category |
| `DELETE` | `/api/emails/:id` | Soft delete + Gmail Trash |
| `POST` | `/api/emails/:id/archive` | Gmail Archive + remove from inbox |

---

## 🧱 Project Structure

```
INBOXIT/
├── server/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js               # MongoDB Atlas connection
│   │   │   ├── redis.js            # Upstash ioredis + keepAlive
│   │   │   └── passport.js         # Google OAuth2 strategy
│   │   ├── controllers/
│   │   │   ├── emailController.js  # cache-aside, CRUD logic
│   │   │   └── syncController.js
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js   # JWT verify
│   │   │   └── tokenRefreshMiddleware.js  # silent token refresh
│   │   ├── models/
│   │   │   ├── User.js
│   │   │   └── Email.js
│   │   ├── queues/
│   │   │   ├── syncQueue.js        # BullMQ Queue definition
│   │   │   └── syncWorker.js       # The core sync engine
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── syncRoutes.js
│   │   │   └── emailRoutes.js
│   │   ├── services/
│   │   │   └── classifier.js       # Rule-based email classifier
│   │   └── utils/
│   │       ├── gmailClient.js      # Authenticated Gmail API instance
│   │       ├── mimeParser.js       # Raw MIME → bodyHtml/bodyText
│   │       └── jwt.js
│   └── index.js
├── client/                         # Next.js frontend (in progress)
└── docker-compose.yml
```

---

## 🐛 Hard Bugs Crushed

Every single one of these hit production and got fixed. No glossing over.

<details>
<summary><strong>Bug 1 — BullMQ worker silently never started</strong></summary>

**Root causes (4 separate issues):**
1. `maxRetriesPerRequest: null` missing — BullMQ v5 requires this or the worker silently refuses to start
2. `tls: {}` vs `tls: { rejectUnauthorized: false }` — Upstash requires the latter
3. Stale failed jobs with a fixed `jobId` permanently blocked all future jobs — fixed with `removeOnFail: { count: 3 }`
4. Worker file not imported in `index.js` — yes, that was it

</details>

<details>
<summary><strong>Bug 2 — isSyncing deadlock (stuck forever)</strong></summary>

Redis dropped mid-job → BullMQ marked job as stalled → lock never released → every subsequent sync silently skipped.

**Fix:** Three escape hatches:
- `stall` / `failed` event handlers reset the flag immediately
- `syncStartedAt` timestamp — auto-unlocks after 10 minutes
- `reset-sync.js` manual recovery script for dev

</details>

<details>
<summary><strong>Bug 3 — Job stalling on large syncs (duplicates)</strong></summary>

Sequential processing of large batches exceeded BullMQ's default lock duration → job marked as stalled → retried → same emails inserted again.

**Fix:** `lockDuration: 10 * 60 * 1000` + `job.updateProgress()` every 500 emails to heartbeat the lock.

</details>

<details>
<summary><strong>Bug 4 — Redis ECONNRESET on long sync jobs</strong></summary>

Upstash closes idle connections. A 130-second sync job goes long stretches without touching Redis. Connection dies silently.

**Fix:** `keepAlive: 5000` + `retryStrategy` + `reconnectOnError` in ioredis config.

</details>

<details>
<summary><strong>Bug 5 — The "Traffic Jam" (Redis quota blowout)</strong></summary>

Express route was firing the initial chunk AND starting the 60-second periodic timer simultaneously. The timer kept waking up, seeing pending pages, and spamming the queue.

**Fix:** Strict handoff — 60-second timer only starts after the initial chunk is 100% complete.

</details>

<details>
<summary><strong>Bug 6 — Duplicate emails in MongoDB</strong></summary>

`Email.create()` blindly inserted every time. Retried jobs = duplicate documents.

**Fix:** `findOneAndUpdate({ userId, gmailMessageId }, { $set: data }, { upsert: true })` + compound unique index `{ userId, gmailMessageId }`.

</details>

---

## 💡 Key Engineering Decisions

| Decision | Why |
|---|---|
| **JWT over sessions** | Stateless — works cleanly with Next.js frontend, no server-side session store |
| **BullMQ over in-process async** | Sync jobs survive server restarts, fully observable, retryable |
| **Upsert everywhere** | Idempotency is non-negotiable in any sync system |
| **Compound index `{userId, gmailMessageId}`** | `gmailMessageId` alone isn't globally unique — different users can have the same ID |
| **labelIds: ["INBOX"]** | Without this, `messages.list` returns Sent, Trash, Spam — everything |
| **Cache-aside, not write-through** | Simpler to reason about, bust on every write, TTL handles the rest |
| **Separate Redis connections for Queue and Worker** | BullMQ requires this — sharing one connection causes silent failures |

---

## 🚀 Running Locally

### Prerequisites
- Node.js 18+
- MongoDB Atlas URI
- Redis (Upstash — free tier works)
- Google Cloud project with Gmail API + OAuth2 credentials

### Setup

```bash
# Clone
git clone https://github.com/Vansh1811/INBOXIT.git
cd INBOXIT

# Server
cd server
npm install
cp .env.example .env   # fill in your credentials
npm run dev

# Client (separate terminal)
cd client
npm install
npm run dev
```

### Environment Variables

```env
# Server (.env)
PORT=5000
MONGO_URI=mongodb+srv://...
REDIS_URL=rediss://...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback
JWT_SECRET=...
FRONTEND_URL=http://localhost:3000

# Client (.env.local)
NEXT_PUBLIC_API_URL=http://localhost:5000
```

### Docker (Optional)

```bash
docker-compose up --build
```

---

## 🗺️ What's left to build

- [ ] **Phase 4** — WebSockets + real-time sync progress (socket.io)
- [ ] **Phase 5** — Next.js frontend (smart folder UI, email detail pane)
- [ ] **Phase 6** — AI digest bar (GPT-4o-mini summary per folder)
- [ ] **Phase 6** — Compose + Reply (Gmail API `messages.send`)
- [ ] Custom domain — `inboxit.in`

---

## 🧠 What I Learned Building This

> This isn't a list of buzzwords. These are things that actually broke in production and forced me to learn.

- **Idempotency is non-negotiable** in any sync system — always upsert, never blindly insert
- **BullMQ v5 requires `maxRetriesPerRequest: null`** — missing it = worker starts but silently never processes jobs
- **Queue and Worker need separate Redis connections** — one shared connection causes silent, unfixable failures
- **`tls: { rejectUnauthorized: false }` is different from `tls: {}`** — Upstash needs the former
- **Stale failed jobs with a fixed `jobId` permanently block all future jobs** — use `removeOnFail`
- **Sync locks need multiple escape hatches** — event handlers + timestamp auto-unlock + manual reset script
- **`messages.list` returns everything without a label filter** — always pass `labelIds: ["INBOX"]`
- **Upstash closes idle connections on long jobs** — always set `keepAlive` in ioredis
- **`nextPageToken` is your resume cursor** — save it after every chunk, not at the end of the whole sync
- **`0 new emails` is a valid success state**, not a panic trigger
- **MongoDB sorts by `_id` (insertion time) by default** — always sort by `receivedAt` explicitly

---

<div align="center">

Built with way too much coffee and way too many 3am Redis errors.

**[⭐ Star this repo](https://github.com/Vansh1811/INBOXIT)** if you find the architecture interesting.

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=100&section=footer" width="100%"/>

</div>
