/**
 * Phase 4 — end-to-end pagination verification against the REAL server.
 *
 * Boots index.js on an isolated port, seeds a SYNTHETIC user + deterministic
 * dataset (duplicate timestamps, mixed flags/categories/folders), then walks
 * cursor chains through the live HTTP API and compares every page sequence
 * against an independently computed canonical ground truth.
 *
 * Everything is wrapped in try/finally with full cleanup. No real user,
 * mailbox, or Gmail data is touched.
 *
 * Usage: node scripts/verify-pagination-phase4.js
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");

const PORT = 5097;
const BASE = `http://localhost:${PORT}`;
const GOOGLE_ID = `phase4-pagination-${Date.now()}`;
const LIMIT = 20;

let checks = 0;
let failures = 0;
function check(name, cond, detail = "") {
  if (cond) { checks++; console.log(`  ✅ ${name}`); }
  else { failures++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function api(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: `jwt=${token}` },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function waitForServer(child) {
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status === 200) return;
    } catch {}
    await new Promise((r2) => setTimeout(r2, 500));
  }
  throw new Error("server never became ready");
}

(async () => {
  const child = spawn(process.execPath, ["index.js"], {
    stdio: "ignore",
    cwd: require("path").resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) },
  });

  try {
    await waitForServer(child);
    console.log("Server ready.\n");

    // ── SEED ────────────────────────────────────────────────────────────────
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;

    const user = {
      googleId: GOOGLE_ID,
      email: `${GOOGLE_ID}@synthetic.invalid`,
      name: "phase4 pagination test",
      // Fresh future expiry so Phase 1's refreshGmailToken fast-path skips
      // the Google roundtrip (no real OAuth tokens exist for this user).
      accessToken: "synthetic",
      refreshToken: "synthetic",
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    };
    const { insertedId: userId } = await db.collection("users").insertOne(user);
    const token = jwt.sign({ id: userId.toString() }, process.env.JWT_SECRET, { expiresIn: "30m" });

    // Deterministic dataset:
    //   90 inbox-visible (12 starred, 18 unread; finance=10, jobs=8)
    //   6 archived (labels: [], not deleted)
    //   4 trashed (isDeleted: true)
    //   Timestamps in groups of THREE identical values → tie-handling stress.
    //   2 "needle" docs (search tests), both inbox+finance.
    const docs = [];
    const mkTs = (i) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + Math.floor(i / 3) * 60_000);
    let seq = 0;
    for (let i = 0; i < 90; i++) {
      const labels = ["INBOX"];
      let category = i < 10 ? "finance" : i < 18 ? "jobs" : "uncategorized";
      let subject = `p4 mail #${seq}`;
      if (i < 2) { subject = "needle unique payload"; category = "finance"; }
      docs.push({
        userId,
        gmailMessageId: `p4-inbox-${i}`,
        from: `sender${i}@test.dev`,
        to: "x@test.dev",
        subject,
        snippet: `snippet ${i}`,
        bodyHtml: "",
        bodyText: "",
        receivedAt: mkTs(i),
        category,
        userOverride: false,
        isRead: !(i % 5 === 0),
        isStarred: i % 8 === 0,
        isDeleted: false,
        labels: [...labels],
      });
      seq++;
    }
    for (let i = 0; i < 6; i++) {
      docs.push({
        userId, gmailMessageId: `p4-arch-${i}`, from: `arch${i}@test.dev`, to: "",
        subject: `p4 archived #${i}`, snippet: "", bodyHtml: "", bodyText: "",
        receivedAt: mkTs(100 + i), category: "uncategorized", userOverride: false,
        isRead: true, isStarred: false, isDeleted: false, labels: [],
      });
    }
    for (let i = 0; i < 4; i++) {
      docs.push({
        userId, gmailMessageId: `p4-trash-${i}`, from: `trash${i}@test.dev`, to: "",
        subject: `p4 trashed #${i}`, snippet: "", bodyHtml: "", bodyText: "",
        receivedAt: mkTs(110 + i), category: "uncategorized", userOverride: false,
        isRead: true, isStarred: false, isDeleted: true, labels: ["INBOX", "TRASH"],
      });
    }
    await db.collection("emails").insertMany(docs);

    // ── GROUND TRUTH (independently sorted canonical order) ────────────────
    const all = await db.collection("emails").find({ userId }).toArray();
    const canon = [...all].sort((x, y) =>
      y.receivedAt.getTime() - x.receivedAt.getTime() ||
      (y._id.toString() > x._id.toString() ? 1 : y._id.toString() < x._id.toString() ? -1 : 0)
    );
    const idsOf = (list) => list.map((d) => d._id.toString());
    const visible = canon.filter((d) => !d.isDeleted && d.labels.includes("INBOX"));
    const expectedInboxIds = idsOf(visible);
    // Exact expected sequences for every folder view, computed from DB ground truth
    const expectedArchiveIds = idsOf(canon.filter((d) => !d.isDeleted && !d.labels.includes("INBOX")));
    const expectedTrashIds   = idsOf(canon.filter((d) => d.isDeleted));
    const expectedPinnedIds  = idsOf(visible.filter((d) => d.isStarred));
    const expectedUnreadIds  = idsOf(visible.filter((d) => !d.isRead));
    const expectedCatIds     = (cat) => idsOf(visible.filter((d) => d.category === cat));
    const seqEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    console.log(`Seeded ${docs.length} emails; inbox-visible=${visible.length}\n`);

    // ── T1/T2: full cursor chain over inbox ────────────────────────────────
    console.log("T1/T2 — inbox cursor chain (limit=20):");
    let cursor = "";
    const collected = [];
    let pages = 0;
    let lastBody = null;
    let firstPageTotal = null;
    do {
      const q = `/api/emails?folder=inbox&limit=${LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { status, body } = await api(q, token);
      check(`page ${pages + 1} → 200`, status === 200 && Array.isArray(body.emails));
      check(`page ${pages + 1} row count ≤ limit`, body.emails.length <= LIMIT, `${body.emails.length}`);
      if (pages === 0) firstPageTotal = body.pagination?.total ?? null;
      collected.push(...body.emails.map((e) => e._id));
      lastBody = body;
      cursor = body.pagination?.nextCursor ?? "";
      pages++;
      if (pages > 20) break; // safety
    } while (cursor);

    const noDup = new Set(collected).size === collected.length;
    check("no duplicate _ids across the whole chain", noDup);
    check(
      "chain covers EXACTLY the canonical inbox set (no missing, no extras)",
      seqEq(collected, expectedInboxIds),
      `collected=${collected.length} expected=${expectedInboxIds.length}`
    );
    check("final page hasMore=false & nextCursor=null",
      lastBody.pagination.hasMore === false && lastBody.pagination.nextCursor === null);
    // total rides ONLY on first-page payloads per contract — capture it there.
    check("first-page payload carries total == inbox count",
      firstPageTotal === visible.length, `${firstPageTotal}`);
    check(
      "identical timestamps stay adjacent & fully ordered (tie-groups intact)",
      (() => {
        const byId = new Map(all.map((d) => [d._id.toString(), d]));
        for (let k = 1; k < collected.length; k++) {
          const prev = byId.get(collected[k - 1]);
          const cur = byId.get(collected[k]);
          const cmp = cur.receivedAt.getTime() - prev.receivedAt.getTime() ||
            (cur._id.toString() > prev._id.toString() ? 1 : -1);
          if (cmp > 0) return false; // must be non-increasing under DESC sort
        }
        return true;
      })()
    );

    // ── T3: invalid cursor → 400 ────────────────────────────────────────────
    console.log("\nT3 — cursor validation:");
    const bad = await api(`/api/emails?folder=inbox&cursor=garbage!!&limit=20`, token);
    check("malformed cursor rejected with 400", bad.status === 400 && bad.body?.message === "Invalid cursor");

    // ── T4: limit normalization ─────────────────────────────────────────────
    console.log("\nT4 — limit handling:");
    const bigLimit = await api(`/api/emails?folder=inbox&limit=5000`, token);
    check("limit clamped at 200", bigLimit.body.emails.length <= 200 && bigLimit.body.emails.length === Math.min(200, visible.length));
    const nanLimit = await api(`/api/emails?folder=inbox&limit=-5`, token);
    check("invalid limit normalized (default 50)", nanLimit.status === 200 && nanLimit.body.emails.length === Math.min(50, visible.length));

    // ── T5: folder filters paginate independently ───────────────────────────
    console.log("\nT5 — filter correctness:");
    async function collectAll(folder, extra = "") {
      let c = ""; const ids = []; let guard = 0;
      do {
        const { status, body } = await api(`/api/emails?folder=${folder}&limit=25${c ? `&cursor=${encodeURIComponent(c)}` : ""}${extra}`, token);
        if (status !== 200 || !Array.isArray(body.emails)) return { error: status, ids: [] };
        ids.push(...body.emails.map((e) => e._id)); // _id strings
        c = body.pagination?.nextCursor ?? ""; guard++;
      } while (c && guard < 50);
      return { ids };
    }

    const archiveRes = await collectAll("archive");
    check("archive = exactly the non-deleted, non-INBOX set (canonical order)",
      seqEq(archiveRes.ids ?? [], expectedArchiveIds),
      `got ${archiveRes.ids?.length} expected ${expectedArchiveIds.length}`);

    const trashRes = await collectAll("trash");
    check("trash = exactly the deleted set", seqEq(trashRes.ids ?? [], expectedTrashIds));

    const pinnedRes = await collectAll("pinned");
    check("pinned = exactly the starred non-deleted set", seqEq(pinnedRes.ids ?? [], expectedPinnedIds));

    const unreadRes = await collectAll("unread");
    check("unread = exactly the unread inbox set", seqEq(unreadRes.ids ?? [], expectedUnreadIds));

    for (const [cat] of [["finance"], ["jobs"], ["food"]]) {
      const r = await collectAll(cat);
      const expected = expectedCatIds(cat);
      check(`category '${cat}' → exact canonical sequence (${expected.length} rows)`,
        seqEq(r.ids ?? [], expected), `got ${r.ids?.length}`);
    }

    // ── T6: search + pagination & search+folder ─────────────────────────────
    console.log("\nT6 — search interaction:");
    const sres = await collectAll("inbox", "&search=" + encodeURIComponent("needle unique"));
    check("search narrows within folder (2 needle docs)",
      seqEq(sres.ids ?? [], idsOf(visible.filter((d) => d.subject.includes("needle")))));
    const sfres = await collectAll("finance", "&search=" + encodeURIComponent("needle"));
    check("search+folder combines both filters",
      seqEq(sfres.ids ?? [], idsOf(visible.filter((d) => d.category === "finance" && d.subject.includes("needle")))));
    const regexProbe = await api(`/api/emails?folder=inbox&search=${encodeURIComponent("(.*")}&limit=5`, token);
    check("regex metacharacters are escaped, not injected", regexProbe.status === 200);

    // ── T7: legacy contract parity (deploy-order safety) ────────────────────
    console.log("\nT7 — legacy offset contract:");
    const legacy = await api(`/api/emails?folder=inbox&offset=0&limit=200`, token);
    check("legacy shape intact (source/emails/totalCount)", legacy.status === 200 &&
      typeof legacy.body.totalCount === "number" && Array.isArray(legacy.body.emails));
    check("legacy totalCount matches cursor-mode total", legacy.body.totalCount === visible.length);
    check("legacy ordering == canonical prefix",
      idsOf(legacy.body.emails).every((id, idx) => id === expectedInboxIds[idx]));

    // ── T8: cache coherence — repeat first page, identical payload ──────────
    console.log("\nT8 — cache coherence:");
    const p1a = await api(`/api/emails?folder=inbox&limit=${LIMIT}`, token);
    const p1b = await api(`/api/emails?folder=inbox&limit=${LIMIT}`, token);
    check("repeat first-page request stable (cache hit)",
      p1b.status === 200 && JSON.stringify(p1a.body.emails.map((e) => e._id)) === JSON.stringify(p1b.body.emails.map((e) => e._id)) &&
      p1a.body.pagination.total === p1b.body.pagination.total);

    // ── T9: unknown folder still 400 (Phase 2 regression) ───────────────────
    const unknown = await api(`/api/emails?folder=people&limit=5`, token);
    check("unknown folder rejected (400)", unknown.status === 400);

    console.log(`\n========== RESULT: ${checks} checks passed, ${failures} failed ==========`);
    if (failures > 0) process.exitCode = 1;
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    // ── CLEANUP (always) ────────────────────────────────────────────────────
    try {
      const db = mongoose.connection.db;
      await db.collection("users").deleteMany({ googleId: GOOGLE_ID });
      await db.collection("emails").deleteMany({ gmailMessageId: { $regex: /^p4-/ } });
      await db.collection("categorypreferences").deleteMany({ senderDomain: /synthetic\.invalid$/ });
      console.log("🧹 Synthetic user + emails removed");
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
    await mongoose.connection.close().catch(() => {});
    if (child.exitCode === null) child.kill("SIGTERM");
    setTimeout(() => process.exit(process.exitCode || 0), 1500).unref();
  }
})();
