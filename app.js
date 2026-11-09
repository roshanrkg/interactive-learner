const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const pool = require('./db');
const { passport } = require('./auth');

const app = express();
const PORT = process.env.PORT || 8081;

// Standard Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session & Passport Middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'interactive_learner_session_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // set to true in HTTPS production
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// API Response Helpers
const respondSuccess = (res, data, status = 200) => {
  return res.status(status).json({
    success: true,
    data,
  });
};

const respondError = (res, message, status = 500) => {
  return res.status(status).json({
    success: false,
    error: message,
  });
};

// Route Protection Middleware
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return respondError(res, 'Unauthorized. Please sign in.', 401);
  }
  return res.redirect('/login');
};

// ==========================================
// Authentication Routes
// ==========================================

// Public login page
app.get('/login', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect('/');
  }
  return res.sendFile(path.join(__dirname, 'static', 'login.html'));
});

// Google OAuth initiate
app.get(
  '/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
  })
);

// Google OAuth callback
app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login?error=auth_failed',
  }),
  (req, res) => {
    return res.redirect('/');
  }
);

// Logout
app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.redirect('/login');
    });
  });
});

// Dev/Demo Quick Login (for testing without leaving localhost)
app.get('/auth/dev-login', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE google_id = ?', ['demo-user-123']);
    let user;
    if (rows.length > 0) {
      user = rows[0];
    } else {
      const [result] = await pool.query(
        'INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)',
        ['demo-user-123', 'demo@learner.com', 'Demo Learner', 'https://api.dicebear.com/7.x/bottts/svg?seed=learner']
      );
      user = {
        id: result.insertId,
        google_id: 'demo-user-123',
        email: 'demo@learner.com',
        name: 'Demo Learner',
        avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=learner',
      };
    }

    req.login(user, (err) => {
      if (err) return res.redirect('/login?error=dev_login_failed');
      return res.redirect('/');
    });
  } catch (err) {
    console.error('Dev login error:', err);
    return res.redirect('/login?error=db_error');
  }
});

// ==========================================
// Static Assets (Available without auth for login page assets)
// ==========================================
app.use('/static', express.static(path.join(__dirname, 'static')));

// ==========================================
// API v1 Routes (Protected)
// ==========================================
const v1Router = express.Router();

// GET /api/v1/auth/me (Returns logged-in user)
v1Router.get('/auth/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return respondSuccess(res, {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      avatar_url: req.user.avatar_url,
    });
  }
  return respondError(res, 'Not authenticated', 401);
});

// GET /api/v1/courses/:slug/syllabus
v1Router.get('/courses/:slug/syllabus', ensureAuthenticated, async (req, res) => {
  const { slug } = req.params;

  if (!slug) {
    return respondError(res, 'course slug is required', 400);
  }

  try {
    // 1. Fetch course details
    const [courses] = await pool.query(
      `SELECT id, title, slug, description, icon, is_active 
       FROM courses 
       WHERE slug = ? AND is_active = 1 
       LIMIT 1`,
      [slug]
    );

    if (courses.length === 0) {
      return respondError(res, `Course '${slug}' not found`, 404);
    }

    const course = {
      ...courses[0],
      is_active: Boolean(courses[0].is_active),
    };

    // 2. Fetch chapters for the course
    const [chapters] = await pool.query(
      `SELECT c.id, c.course_id, c.title, c.order_index
       FROM chapters c
       JOIN courses co ON c.course_id = co.id
       WHERE co.slug = ?
       ORDER BY c.order_index ASC`,
      [slug]
    );

    // 3. Fetch lessons for the course
    const [lessons] = await pool.query(
      `SELECT l.id, l.chapter_id, l.title, l.slug, l.order_index, l.read_time_minutes, l.difficulty
       FROM lessons l
       JOIN chapters c ON l.chapter_id = c.id
       JOIN courses co ON c.course_id = co.id
       WHERE co.slug = ?
       ORDER BY c.order_index ASC, l.order_index ASC`,
      [slug]
    );

    // Group lessons under their corresponding chapter
    const chapterMap = new Map();
    const formattedChapters = chapters.map((ch) => {
      const chapterObj = {
        id: ch.id,
        course_id: ch.course_id,
        title: ch.title,
        order_index: ch.order_index,
        lessons: [],
      };
      chapterMap.set(ch.id, chapterObj);
      return chapterObj;
    });

    for (const lesson of lessons) {
      if (chapterMap.has(lesson.chapter_id)) {
        chapterMap.get(lesson.chapter_id).lessons.push({
          id: lesson.id,
          chapter_id: lesson.chapter_id,
          title: lesson.title,
          slug: lesson.slug,
          order_index: lesson.order_index,
          read_time_minutes: lesson.read_time_minutes,
          difficulty: lesson.difficulty,
        });
      }
    }

    return respondSuccess(res, {
      course,
      chapters: formattedChapters,
    });
  } catch (err) {
    console.error('Error fetching syllabus:', err);
    return respondError(res, `failed to load course syllabus: ${err.message}`, 500);
  }
});

// GET /api/v1/lessons/:slug
v1Router.get('/lessons/:slug', ensureAuthenticated, async (req, res) => {
  const { slug } = req.params;

  if (!slug) {
    return respondError(res, 'lesson slug is required', 400);
  }

  try {
    // 1. Fetch main lesson content
    const [rows] = await pool.query(
      `SELECT 
         l.id, l.chapter_id, c.title AS chapter_title, l.title, l.slug, 
         l.order_index, l.read_time_minutes, l.difficulty, 
         COALESCE(l.summary_hook, '') AS summary_hook, 
         COALESCE(l.content_body, '') AS content_body, 
         COALESCE(l.pitfalls_gotchas, '') AS pitfalls_gotchas, 
         COALESCE(l.real_world_analogy, '') AS real_world_analogy, 
         COALESCE(l.line_by_line_explanation, '') AS line_by_line_explanation, 
         COALESCE(l.image_url, '') AS image_url, 
         COALESCE(l.code_snippet, '') AS code_snippet, 
         COALESCE(l.code_language, 'python') AS code_language, 
         COALESCE(l.expected_output, '') AS expected_output
       FROM lessons l
       JOIN chapters c ON l.chapter_id = c.id
       WHERE l.slug = ?
       LIMIT 1`,
      [slug]
    );

    if (rows.length === 0) {
      return respondError(res, `Lesson '${slug}' not found`, 404);
    }

    const lesson = { ...rows[0] };

    // 2. Fetch adjacent lessons (prev & next)
    const [prevRows] = await pool.query(
      `SELECT slug, title FROM lessons WHERE id < ? ORDER BY id DESC LIMIT 1`,
      [lesson.id]
    );
    const [nextRows] = await pool.query(
      `SELECT slug, title FROM lessons WHERE id > ? ORDER BY id ASC LIMIT 1`,
      [lesson.id]
    );

    lesson.prev_lesson_slug = prevRows.length > 0 ? prevRows[0].slug : '';
    lesson.prev_lesson_title = prevRows.length > 0 ? prevRows[0].title : '';
    lesson.next_lesson_slug = nextRows.length > 0 ? nextRows[0].slug : '';
    lesson.next_lesson_title = nextRows.length > 0 ? nextRows[0].title : '';

    // 3. Fetch practice exercise (if available)
    const [exerciseRows] = await pool.query(
      `SELECT id, lesson_id, title, instruction, COALESCE(starter_code, '') AS starter_code, solution_code, COALESCE(hint, '') AS hint
       FROM practice_exercises
       WHERE lesson_id = ?
       LIMIT 1`,
      [lesson.id]
    );
    if (exerciseRows.length > 0) {
      lesson.exercise = exerciseRows[0];
    }

    // 4. Fetch interactive MCQ quiz (if available)
    const [quizRows] = await pool.query(
      `SELECT id, lesson_id, question, option_a, option_b, option_c, option_d, points
       FROM quizzes
       WHERE lesson_id = ?
       LIMIT 1`,
      [lesson.id]
    );
    if (quizRows.length > 0) {
      lesson.quiz = quizRows[0];
    }

    return respondSuccess(res, lesson);
  } catch (err) {
    console.error('Error fetching lesson:', err);
    return respondError(res, `failed to load lesson: ${err.message}`, 500);
  }
});

// POST /api/v1/quizzes/verify
v1Router.post('/quizzes/verify', ensureAuthenticated, async (req, res) => {
  const { quiz_id, selected_option } = req.body || {};

  if (!quiz_id || !selected_option) {
    return respondError(res, 'invalid quiz submission: quiz_id and selected_option are required', 400);
  }

  const option = String(selected_option).trim().toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(option)) {
    return respondError(res, 'invalid option selected: must be A, B, C, or D', 400);
  }

  try {
    const [rows] = await pool.query(
      `SELECT correct_option, explanation, points
       FROM quizzes
       WHERE id = ?
       LIMIT 1`,
      [quiz_id]
    );

    if (rows.length === 0) {
      return respondError(res, 'quiz not found', 400);
    }

    const { correct_option, explanation, points } = rows[0];
    const normalizedCorrect = String(correct_option).trim().toUpperCase();
    const isCorrect = option === normalizedCorrect;
    const pointsAwarded = isCorrect ? points : 0;

    return respondSuccess(res, {
      is_correct: isCorrect,
      correct_option: normalizedCorrect,
      explanation: explanation || '',
      points_awarded: pointsAwarded,
    });
  } catch (err) {
    console.error('Error verifying quiz answer:', err);
    return respondError(res, `failed to verify answer: ${err.message}`, 500);
  }
});

// Health check endpoint
v1Router.get('/health', (req, res) => {
  return respondSuccess(res, { status: 'ok', timestamp: new Date().toISOString() });
});

// Mount API router
app.use('/api/v1', v1Router);

// ==========================================
// SPA Protected Root & Fallback
// ==========================================
app.get('/', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// Fallback to index.html for authenticated client-side routing
app.use((req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.sendFile(path.join(__dirname, 'static', 'index.html'));
  }
  return res.redirect('/login');
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  return respondError(res, err.message || 'Internal Server Error', 500);
});

// ==========================================
// Start Server
// ==========================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Interactive Learner Node.js Server is live at http://localhost:${PORT}`);
    console.log(`👉 API Base: http://localhost:${PORT}/api/v1`);
    console.log(`🔑 Login Page: http://localhost:${PORT}/login`);
  });
}

module.exports = app;
