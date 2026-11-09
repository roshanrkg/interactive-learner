# Interactive Learner - Node.js Backend

A Node.js & Express replicate of the Interactive Learner Golang backend (`newp`). Connects to MySQL (`notes_db`) and serves an interactive learning web application.

---

## Features
- **Syllabus Hierarchy API**: Dynamically loads courses, chapters, and ordered lessons from MySQL.
- **Lesson Engine**: Delivers rich educational content, real-world analogies, line-by-line breakdowns, pitfalls, SVG diagrams, and coding exercises.
- **Interactive Quiz Verification**: Evaluates multiple-choice submissions, computes scores, and returns explanations.
- **Static & SPA Serving**: Serves the single-page frontend from `./static/index.html` and visual diagrams from `./static/images`.

---

## Getting Started

### 1. Prerequisites
- **Node.js** v18+
- **MySQL / LAMPP** running with `notes_db`

### 2. Configuration
Verify database credentials in [`.env`](.env):
```env
PORT=8080
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=notes_db
```

### 3. Running the Server
```bash
# Start server
npm start

# Or with Node watch mode (auto-reload on save)
npm run dev
```

Visit [http://localhost:8080](http://localhost:8080) in your browser.

---

## API Reference

Base URL: `/api/v1`

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server health check |
| `GET` | `/courses/:slug/syllabus` | Fetch course details and syllabus chapters/lessons |
| `GET` | `/lessons/:slug` | Fetch lesson content, exercises, quizzes, and pagination |
| `POST` | `/quizzes/verify` | Submit quiz answer for grading and point calculation |
| `GET` | `/static/*` | Static assets (SVG diagrams, stylesheets) |
| `GET` | `*` | SPA fallback serving `index.html` |
