import express from "express";
import fileUpload from "express-fileupload";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { nanoid } from "nanoid";
import os from "os";
import fetch from "node-fetch";




const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// --- Config ---
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const YT_API_KEY = process.env.YT_API_KEY || "";


// --- Data dirs ---
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const OUTPUT_DIR = path.join(DATA_DIR, "outputs");
for (const d of [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR]) {
fs.mkdirSync(d, { recursive: true });
}


// --- LowDB (JSON) ---
const dbFile = path.join(DATA_DIR, "db.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { files: [], jobs: [] }); // files: uploaded & transcoded, jobs: transcode jobs
await db.read();
if (!db.data) db.data = { files: [], jobs: [] };
await db.write();


// --- Demo users (hard-coded, per brief) ---
const USERS = [
{ id: "u1", username: "alice", password: "pass123", role: "admin" },
{ id: "u2", username: "bob", password: "pass123", role: "user" }
];


// --- Express app ---
const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(fileUpload({ limits: { fileSize: 1024 * 1024 * 1024 } })); // up to 1GB demo
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth helpers ---
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  let token = h.startsWith("Bearer ") ? h.slice(7) : null;

  // NEW: allow token in query string for simple <a> downloads
  if (!token && req.query && typeof req.query.token === "string") {
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}


// --- Routes ---
app.get("/health", (_req, res) => res.json({ ok: true }));


// Login → returns JWT
app.post("/login", (req, res) => {
const { username, password } = req.body || {};
const user = USERS.find(u => u.username === username && u.password === password);
if (!user) return res.status(401).json({ error: "Invalid credentials" });
const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "2h" });
res.status(200).json({ token });
});


// Upload video (multipart form-data: field name = "file")
app.post("/upload", auth, async (req, res) => {
if (!req.files || !req.files.file) return res.status(400).json({ error: "No file uploaded" });
const f = req.files.file; // express-fileupload: UploadedFile or array
const file = Array.isArray(f) ? f[0] : f;
const id = nanoid();
const safeName = (file.name || "video").replace(/[^a-zA-Z0-9._-]/g, "_");
const dest = path.join(UPLOAD_DIR, `${id}_${safeName}`);
await file.mv(dest);


db.data.files.push({
id,
owner: req.user.sub,
kind: "original",
name: safeName,
path: dest,
size: file.size,
mimetype: file.mimetype,
createdAt: Date.now()
});
await db.write();


res.status(201).json({ fileId: id });
});

// List current user's files
app.get("/files", auth, async (req, res) => {
const mine = db.data.files.filter(f => f.owner === req.user.sub).sort((a,b)=>b.createdAt-a.createdAt);
res.json({ files: mine });
});


// Download a file by id (original or transcoded)
app.get("/download/:id", auth, async (req, res) => {
const f = db.data.files.find(x => x.id === req.params.id && x.owner === req.user.sub);
if (!f) return res.status(404).json({ error: "File not found" });
if (!fs.existsSync(f.path)) return res.status(410).json({ error: "File no longer exists on server" });
return res.download(f.path, f.name);
});


// Request a transcode to MP4 (CPU-intensive) → async; returns a jobId
app.post("/transcode/:id", auth, async (req, res) => {
const input = db.data.files.find(x => x.id === req.params.id && x.owner === req.user.sub && x.kind === "original");
if (!input) return res.status(404).json({ error: "Original video not found" });


const outId = nanoid();
const jobId = nanoid();
const outName = input.name.replace(/\.[^.]+$/, "") + "_transcoded.mp4";
const outPath = path.join(OUTPUT_DIR, `${outId}_${outName}`);


// Record output placeholder + job
db.data.files.push({ id: outId, owner: req.user.sub, kind: "transcoded", name: outName, path: outPath, size: 0, mimetype: "video/mp4", createdAt: Date.now() });
db.data.jobs.push({ id: jobId, owner: req.user.sub, inputId: input.id, outputId: outId, status: "queued", startedAt: null, finishedAt: null, error: null });
await db.write();


// Start heavy work next tick
setImmediate(() => runTranscodeJob(jobId, input.path, outPath));


res.status(202).json({ jobId, outputFileId: outId });
});

// (Optional) Check job status (not required by brief, but helpful)
app.get("/jobs/:id", auth, async (req, res) => {
const j = db.data.jobs.find(j => j.id === req.params.id && j.owner === req.user.sub);
if (!j) return res.status(404).json({ error: "Job not found" });
res.json(j);
});

// YouTube related videos for a file name (requires YT_API_KEY)
app.get("/related/:id", auth, async (req, res) => {
  try {
    const file = db.data.files.find(
      f => f.id === req.params.id && f.owner === req.user.sub
    );
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!YT_API_KEY) return res.status(500).json({ error: "YT_API_KEY not set" });

    // Build a simple search query from the filename (no extension, nicer spacing)
    const base = (file.name || "")
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "video";

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "8");
    url.searchParams.set("q", base);
    url.searchParams.set("key", YT_API_KEY);

    // Node 18+ has global fetch; if your Node is older, install node-fetch and import it.
    const resp = await fetch(url);
    if (!resp.ok) return res.status(502).json({ error: `YouTube API ${resp.status}` });

    const data = await resp.json();
    const items = (data.items || [])
      .map(it => ({
        title: it.snippet?.title,
        channel: it.snippet?.channelTitle,
        thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url,
        url: it.id?.videoId ? `https://www.youtube.com/watch?v=${it.id.videoId}` : null
      }))
      .filter(x => x.url);

    res.json({ query: base, items });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});



function runTranscodeJob(jobId, inPath, outPath) {
const job = db.data.jobs.find(j => j.id === jobId);
if (!job) return;
job.status = "running";
job.startedAt = Date.now();
db.write();


// Heavy FFmpeg settings: libx264 + veryslow to peg CPU; audio AAC
const args = [
"-y", "-hide_banner", "-loglevel", "error",
"-i", inPath,
"-c:v", "libx264", "-preset", "veryslow", "-crf", "23",
"-c:a", "aac", "-b:a", "128k",
"-movflags", "+faststart",
outPath
];


const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
proc.on("error", async (err) => {
  const j = db.data.jobs.find(j => j.id === jobId);
  if (j) {
    j.status = "error";
    j.finishedAt = Date.now();
    j.error = `spawn error: ${err.message}`;
    await db.write();
  }
});



proc.stderr.on("data", (d) => {
// Could stream logs to a file if desired
});


proc.on("close", async (code) => {
const j = db.data.jobs.find(j => j.id === jobId);
const f = db.data.files.find(f => f.path === outPath);
if (code === 0) {
j.status = "done";
j.finishedAt = Date.now();
try { const st = fs.statSync(outPath); if (f) f.size = st.size; } catch {}
} else {
j.status = "error";
j.finishedAt = Date.now();
j.error = `ffmpeg exited with code ${code}`;
// best-effort cleanup of failed output
try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
}
await db.write();
});
}


app.listen(PORT, () => console.log(`API listening on http://0.0.0.0:${PORT}`));