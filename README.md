<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=200&section=header&text=InboxIt&fontSize=80&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=Your%20Gmail.%20Actually%20Smart.&descAlignY=55&descAlign=50" width="100%"/>

# 📬 InboxIt

### A production-grade Gmail client that auto-sorts your inbox into smart folders. Live and open source.

[![Live Demo](https://img.shields.io/badge/🚀%20Live%20Demo-inboxit.vercel.app-667eea?style=for-the-badge)](https://inboxit.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-Upstash-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://upstash.com)
[![BullMQ](https://img.shields.io/badge/BullMQ-Queue%20Engine-FF6B6B?style=for-the-badge)](https://docs.bullmq.io)
[![socket.io](https://img.shields.io/badge/socket.io-Real--time-010101?style=for-the-badge&logo=socket.io)](https://socket.io)

</div>

---

## 🤔 Why I built this

Gmail is chaos. Job alerts buried under food delivery notifications. Internship emails lost in promotional spam. Razorpay transactions, Swiggy receipts, Naukri pings — all flattened into one endless list.

InboxIt connects to your Gmail, syncs emails in the background using a **chunked BullMQ queue engine**, and automatically drops them into smart folders: **Jobs, Finance, Food, Travel, Health, Social**. No manual filters. No sorting rules. Just open the app and your inbox is already organized.

Built entirely from scratch — no email SDK shortcuts, no pre-built inbox templates. Raw Gmail API, custom MIME parser, custom classifier, production-grade sync architecture. **Deployed and live at [inboxit.vercel.app](https://inboxit.vercel.app).**

---

## ✨ Features

| Feature | What it does |
|---|---|
| 🔐 **Google OAuth2** | One-click sign-in, JWT issued on login, stored in cookies |
| ⚡ **Chunked Sync Engine** | Syncs 500 emails/chunk via BullMQ, fully resumable |
| 🔄 **Live Tracker** | Incremental sync every 60s via Gmail History API |
| 🗂️ **Smart Folders** | Auto-classifies into Jobs, Finance, Food, Travel, Health, Social |
| ⚡ **Redis Caching** | Folder queries served in <50ms after first load |
| 📖 **Load More** | Lazy-load older emails on demand |
| 🗑️ **Trash / Archive** | Syncs back to real Gmail — delete in InboxIt, gone in Gmail |
| 🔒 **Token Auto-Refresh** | Gmail OAuth token refreshed silently before every request |
| 📡 **WebSockets** | Real-time sync progress pushed to frontend via socket.io |
| 🔍 **Search** | Search across your synced emails |
| 🌐 **REST API** | Clean endpoints for list, detail, update, delete, archive |

---

## 📸 Screenshots  **Dashboard — Smart Folders in action**  ![InboxIt Dashboard - Jobs Folder](https://raw.githubusercontent.com/Vansh1811/INBOXIT/main/H5tRq.jpg)  **Inbox View — Live sync progress**  ![InboxIt Inbox - Live Sync](https://raw.githubusercontent.com/Vansh1811/INBOXIT/main/SsrG4.jpg)  ---  ## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Client (Next.js · Vercel)                      │
│    JWT in js-cookie · SWR for data · socket.io-client v4         │
└──────────────────────┬──────────────────────────────────────────┘
                       │ REST (JWT)         ↕ socket.io (real-time)
┌──────────────────────▼──────────────────────────────────────────┐
│                      Express 5 API Server                        │
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
│  │ Redis       │  │  7. Emit progress via socket.io           │   │
│  │ (Upstash)   │  │  8. Start 60s incremental tracker         │   │
│  │ BullMQ qs   │  └─────────────────────────────────────────-┘   │
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
- Pushes progress events to the client via socket.io

---

## 🗂️ Smart Folder Classification

The classifier runs on every email using sender domain + subject keyword matching:

| Folder | What goes here |
|---|---|
| 💼 **jobs** | Naukri, LinkedIn, Internshala, Wellfound, Cutshort, Instahyre, Hirist, Accenture, Freshers, Careers |
| 💰 **finance** | Banks, HDFC, SBI, Paytm, PhonePe, Razorpay, GPay, ICICI, mutual funds, statements |
| 🍔 **food** | Swiggy, Zomato, Zepto, food delivery receipts |
| 🚕 **travel** | Uber, Ola, Rapido, ride receipts, travel bookings |
| 🏥 **health** | Apollo, Practo, PharmEasy, 1MG, doctor, appointment |
| 👥 **social** | Facebook, Instagram, Twitter, WhatsApp, Reddit, LinkedIn social |
| 📥 **inbox** | Everything else, not archived, sorted by date |

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
│   │   │   ├── redis.js            # Upstash node-redis v5 + keepAlive
│   │   │   ├── passport.js         # Google OAuth2 strategy
│   │   │   └── socket.js           # socket.io init + getIO() helper
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
├── client/                         # Next.js 16 + React 19 — deployed on Vercel
│   ├── app/
│   │   ├── auth/success/           # OAuth callback handler
│   │   ├── dashboard/
│   │   │   ├── inbox/              # All mail view
│   │   │   └── [folder]/           # Dynamic smart folder route
│   │   ├── layout.tsx
│   │   └── page.tsx                # Landing page
│   ├── components/
│   │   ├── Sidebar.tsx             # Smart folder navigation
│   │   ├── EmailList.tsx           # Paginated email list
│   │   ├── EmailDetail.tsx         # Email body (DOMPurify sanitized)
│   │   ├── SearchBar.tsx           # Client-side search
│   │   ├── SyncProgressBar.tsx     # Real-time sync progress via socket.io
│   │   └── Toast.tsx               # Notifications
│   ├── lib/                        # API helpers + socket client
│   └── middleware.ts               # JWT auth guard on protected routes
└── docker-compose.yml
```

---

## 🐛 Hard Bugs Crushed

Every single one of these hit in real development and got fixed.

<details>
<summary><strong>Bug 1 — BullMQ worker silently never started</strong></summary>

**Root causes (4 separate issues):**
1. `maxRetriesPerRequest: null` missing — BullMQ v5 requires this or the worker silently refuses to start
2. `tls: {}` vs `tls: { rejectUnauthorized: false }` — Upstash requires the latter
3. Stale failed jobs with a fixed `jobId` permanently blocked all future jobs — fixed with `removeOnFail: { count: 3 }`
4. Worker file not imported in `index.js`

</details>

<details>
<summary><strong>Bug 2 — isSyncing deadlock (stuck forever)</strong></summary>

Redis dropped mid-job → BullMQ marked job as stalled → lock never released → every subsequent sync silently skipped.

**Fix:** Three escape hatches:
- `stall` / `failed` event handlers reset the flag immediately
- `syncStartedAt` timestamp — auto-unlocks after 10 minutes
- Manual reset via MongoDB update for local recovery

</details>

<details>
<summary><strong>Bug 3 — Job stalling on large syncs (duplicates)</strong></summary>

Sequential processing of large batches exceeded BullMQ's default lock duration → job marked as stalled → retried → same emails inserted again.

**Fix:** `lockDuration: 10 * 60 * 1000` + `job.updateProgress()` every 500 emails to heartbeat the lock.

</details>

<details>
<summary><strong>Bug 4 — Redis connection reset on long sync jobs</strong></summary>

Upstash closes idle connections. A long sync job goes stretches without touching Redis. Connection dies silently.

**Fix:** `keepAlive` + `retryStrategy` + `reconnectOnError` in node-redis config.

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

<details>
<summary><strong>Bug 7 — Emails appearing in wrong order</strong></summary>

Worker processes 100 emails concurrently via `Promise.all`. Whichever API response resolves first saves to MongoDB first. Default MongoDB sort is by `_id` (insertion time), not email date.

**Fix:** No worker changes needed. `emailController.js` always applies `.sort({ receivedAt: -1 })` when serving to the frontend.

</details>

<details>
<summary><strong>Bug 8 — Gmail client failing mid-request</strong></summary>

`getGmailClient(req.user.id)` was passed just the ID string, but the function needs the full user object with `accessToken` and `refreshToken`.

**Fix:** Always fetch full user first → `const user = await User.findById(req.user.id)` → then pass `user` to `getGmailClient`.

</details>

---

## 💡 Key Engineering Decisions

| Decision | Why |
|---|---|
| **JWT over sessions** | Stateless — works cleanly with Next.js frontend, no server-side session store |
| **JWT in js-cookie** | Accessible from Next.js client, simpler than httpOnly for this architecture |
| **BullMQ over in-process async** | Sync jobs survive server restarts, fully observable, retryable |
| **Upsert everywhere** | Idempotency is non-negotiable in any sync system |
| **Compound index `{userId, gmailMessageId}`** | `gmailMessageId` alone isn't globally unique — different users can have the same ID |
| **`labelIds: ["INBOX"]`** | Without this, `messages.list` returns Sent, Trash, Spam — everything |
| **Cache-aside, not write-through** | Simpler to reason about, bust on every write, TTL handles the rest |
| **Separate Redis connections for Queue and Worker** | BullMQ requires this — sharing one connection causes silent failures |
| **socket.io over raw WebSockets** | Built-in reconnection, rooms (one per userId), fallback to long-polling |
| **DOMPurify on email body** | Email HTML can contain scripts — always sanitize before rendering |

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

### Docker

```bash
docker-compose up --build
```

---

## 🗺️ What's left to build

- [ ] **AI digest bar** — GPT-4o-mini one-line summary per smart folder
- [ ] **Compose / Reply** — Gmail API `messages.send` with thread context
- [ ] **Custom domain** — `inboxit.in`

---

## 🧠 What I Learned Building This

> Not a list of buzzwords. These are things that actually broke and forced me to learn.

- **Idempotency is non-negotiable** in any sync system — always upsert, never blindly insert
- **BullMQ v5 requires `maxRetriesPerRequest: null`** — missing it = worker starts but silently never processes jobs
- **Queue and Worker need separate Redis connections** — one shared connection causes silent, unfixable failures
- **`tls: { rejectUnauthorized: false }` is different from `tls: {}`** — Upstash needs the former
- **Stale failed jobs with a fixed `jobId` permanently block all future jobs** — use `removeOnFail`
- **Sync locks need multiple escape hatches** — event handlers + timestamp auto-unlock + manual reset
- **`messages.list` returns everything without a label filter** — always pass `labelIds: ["INBOX"]`
- **Redis closes idle connections on long jobs** — always configure `keepAlive` and `retryStrategy`
- **`nextPageToken` is your resume cursor** — save it after every chunk, not at the end of the whole sync
- **`0 new emails` is a valid success state**, not a panic trigger
- **MongoDB sorts by `_id` (insertion time) by default** — always sort by `receivedAt` explicitly
- **Always sanitize email HTML before rendering** — email bodies can contain malicious scripts

---

<div align="center">

Built with too much coffee and too many 3am Redis errors.

**[⭐ Star this repo](https://github.com/Vansh1811/INBOXIT)** if you find the architecture interesting.

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=100&section=footer" width="100%"/>

</div>
