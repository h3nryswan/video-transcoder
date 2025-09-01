# Assignment 1 - REST API Project - Response to Criteria

**Note:** Resubmission to include the response to marking criteria file approved by CAB432 teaching team (Jake Bradford). No other changes to files.

---

## Overview

- **Name:** Henry Swan  
- **Student number:** n11049481  
- **Application name:** Video Transcoder  
- **Two line description:**  
  Users upload a video, queue a CPU-intensive transcode to H.264/MP4, then download the result.  
  A simple web client exercises the REST API and also shows YouTube “related videos” for the uploaded filename.

---

## Core Criteria

### Containerise the App
- **ECR Repository name:** `n11049481/videotranscoder`  
  *(Full URI: `901444280953.dkr.ecr.ap-southeast-2.amazonaws.com/n11049481/videotranscoder:latest`)*  
- **Video timestamp:** ⬜ 4:10  
- **Relevant files:**  
  - `/Dockerfile` (installs ffmpeg, copies app, `npm ci --omit=dev`, `EXPOSE 3000`, `CMD ["node","server.js"]`)

---

### Deploy the Container
- **EC2 instance ID:** `i-07cae16bd920e452c`  
- **Video timestamp:** 4:30  
- **Notes:** Pulled image from ECR and ran:  
  ```bash
  docker run -d -p 8080:3000     -e JWT_SECRET=...     -v /home/ssm-user/data:/app/data     901444280953.dkr.ecr.ap-southeast-2.amazonaws.com/n11049481/videotranscoder:latest
  ```

---

### User Login
- **Description:** Hard-coded user list (`alice`, `bob`) with passwords; login returns a JWT. All protected endpoints require `Authorization: Bearer <token>`.  
- **Video timestamp:** ⬜ 00:45  
- **Relevant files:**  
  - `/server.js` (users array, `/login` route using `jsonwebtoken`)

---

### REST API
- **Description:** Clean REST endpoints with proper HTTP methods and status codes.  
- **Video timestamp:** ⬜ 01:00  
- **Relevant files:**  
  - `/server.js`

**Endpoints:**
- `POST /login` → `200 (JWT)` / `401`  
- `POST /upload (multipart)` → `201 (fileId)` / `400`  
- `GET /files` → `200 (current user’s files)`  
- `POST /transcode/:id` → `202 (jobId, outputFileId)` / `404`  
- `GET /jobs/:id` → `200` / `404`  
- `GET /download/:id` → `200 (file)` / `404` / `410`  
- `GET /related/:id` → `200 (YouTube results)` / `404`  

---

### Data Types

**First kind**  
- **Description:** Uploaded and transcoded video files  
- **Type:** Unstructured  
- **Rationale:** Large binary blobs; no need for DB inspection. Stored as files.  
- **Video timestamp:** ⬜ 01:30  
- **Relevant files/paths:**  
  - `/server.js` (paths + `res.download`)  
  - `/data/uploads/*` and `/data/outputs/*`  

**Second kind**  
- **Description:** File and job metadata (owner, names, timestamps, job status)  
- **Type:** Structured, no ACID  
- **Rationale:** Queried frequently; simple CRUD of small records.  
- **Storage:** LowDB (JSON) at `/data/db.json` (migratable later)  
- **Video timestamp:** ⬜ 01:45  
- **Relevant files:**  
  - `/server.js` (LowDB setup with Low + JSONFile)  
  - `/data/db.json`  

---

### CPU Intensive Task
- **Description:** CPU-heavy H.264 transcode using ffmpeg with `-preset veryslow` to maximize CPU load.  
- **Video timestamp:** ⬜ 02:00  
- **Relevant files:**  
  - `/server.js` → `runTranscodeJob()` (spawns ffmpeg, updates job status; output MP4)

---

### CPU Load Testing
- **Description:** Show CPU >80% on instance metrics / `docker stats` / `htop`.  
- **Video timestamp:** ⬜ 04:00  

---

## Additional Criteria

### Extensive REST API Features
- **Description:** Partial — consistent methods/status codes and sorted `/files`; pagination/filtering/versioning planned for A2.  
- **Video timestamp:** ⬜ 01:10  
- **Relevant files:**  
  - `/server.js` (`/files` sorted newest-first; auth middleware; CORS/morgan)

---

### External API(s)
- **Description:** YouTube Data API used to fetch related videos (title, thumbnail, channel, link) based on uploaded filename.  
- **Video timestamp:** ⬜ 01:20  
- **Relevant files:**  
  - `/server.js` (`GET /related/:id` calls YouTube API with `YT_API_KEY`)  
  - `/public/index.html` (Related drawer UI)

---

### Additional Types of Data
- **Description:** Not attempted  

---

### Custom Processing
- **Description:** Not attempted  

---

### Infrastructure as Code
- **Description:** Docker Compose for local/dev orchestration (app + optional MariaDB). Deployment to EC2 done via Docker CLI with ECR image.  
- **Video timestamp:** ⬜ 4:20  
- **Relevant files:**  
  - `/docker-compose.yml`  
  - `.env` (ports, JWT secret, optional DB creds, YouTube API key)

---

### Web Client
- **Description:** Single-page web client exercises all endpoints: login, upload, list, transcode, job status polling, download (JWT), related videos in a slide-out drawer.  
- **Video timestamp:** ⬜ 00:55  
- **Relevant files:**  
  - `/public/index.html`

---

### Upon Request
- **Description:** Not attempted  
