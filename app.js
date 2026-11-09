const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const pool = require('./db');
const { passport } = require('./auth');
const { generateVisualization } = require('./services/visualizer');

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

    // Record submission into MySQL
    const userId = req.user.id;
    await pool.query(
      `INSERT INTO user_quiz_submissions (user_id, quiz_id, selected_option, is_correct, points_awarded)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         selected_option = VALUES(selected_option),
         is_correct = VALUES(is_correct),
         points_awarded = VALUES(points_awarded)`,
      [userId, quiz_id, option, isCorrect, pointsAwarded]
    );

    // Fetch updated total user points
    const [sumRows] = await pool.query(
      `SELECT COALESCE(SUM(points_awarded), 0) AS total_points FROM user_quiz_submissions WHERE user_id = ?`,
      [userId]
    );
    const totalPoints = sumRows[0]?.total_points || 0;

    return respondSuccess(res, {
      is_correct: isCorrect,
      correct_option: normalizedCorrect,
      explanation: explanation || '',
      points_awarded: pointsAwarded,
      total_points: totalPoints,
    });
  } catch (err) {
    console.error('Error verifying quiz answer:', err);
    return respondError(res, `failed to verify answer: ${err.message}`, 500);
  }
});

// GET /api/v1/user/progress
v1Router.get('/user/progress', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch completed lesson slugs
    const [progressRows] = await pool.query(
      `SELECT l.slug 
       FROM user_lesson_progress ulp
       JOIN lessons l ON ulp.lesson_id = l.id
       WHERE ulp.user_id = ?`,
      [userId]
    );

    // Fetch total quiz points earned
    const [pointsRows] = await pool.query(
      `SELECT COALESCE(SUM(points_awarded), 0) AS total_points
       FROM user_quiz_submissions
       WHERE user_id = ?`,
      [userId]
    );

    // Fetch quiz answers submitted by user
    const [submissionRows] = await pool.query(
      `SELECT quiz_id, selected_option, is_correct, points_awarded
       FROM user_quiz_submissions
       WHERE user_id = ?`,
      [userId]
    );

    const completedSlugs = progressRows.map((r) => r.slug);
    const totalPoints = pointsRows[0]?.total_points || 0;

    return respondSuccess(res, {
      completed_slugs: completedSlugs,
      total_points: totalPoints,
      submissions: submissionRows,
    });
  } catch (err) {
    console.error('Error fetching user progress:', err);
    return respondError(res, `failed to load progress: ${err.message}`, 500);
  }
});

// POST /api/v1/lessons/:slug/complete
v1Router.post('/lessons/:slug/complete', ensureAuthenticated, async (req, res) => {
  const { slug } = req.params;
  const userId = req.user.id;

  try {
    const [lessonRows] = await pool.query('SELECT id FROM lessons WHERE slug = ? LIMIT 1', [slug]);
    if (lessonRows.length === 0) {
      return respondError(res, 'lesson not found', 404);
    }

    const lessonId = lessonRows[0].id;
    await pool.query(
      'INSERT IGNORE INTO user_lesson_progress (user_id, lesson_id) VALUES (?, ?)',
      [userId, lessonId]
    );

    return respondSuccess(res, { completed: true, slug });
  } catch (err) {
    console.error('Error saving lesson progress:', err);
    return respondError(res, `failed to save progress: ${err.message}`, 500);
  }
});

// POST /api/v1/visualize
v1Router.post('/visualize', ensureAuthenticated, async (req, res) => {
  const { topic, language, code, lesson_title, force_refresh } = req.body || {};

  if (!topic) {
    return respondError(res, 'topic is required for visualization', 400);
  }

  const cleanTopic = String(topic).trim();
  const cleanLang = String(language || 'Python').trim();
  const userId = req.user.id;

  try {
    // 1. Check database cache first if not explicitly force_refresh
    if (!force_refresh) {
      const [cachedRows] = await pool.query(
        `SELECT id, topic, language, code_snippet, html_content, created_at 
         FROM user_visualizations 
         WHERE user_id = ? AND LOWER(TRIM(topic)) = LOWER(TRIM(?)) AND LOWER(TRIM(language)) = LOWER(TRIM(?))
         ORDER BY id DESC LIMIT 1`,
        [userId, cleanTopic, cleanLang]
      );

      if (cachedRows.length > 0) {
        const cached = cachedRows[0];
        return respondSuccess(res, {
          id: cached.id,
          html: cached.html_content,
          topic: cached.topic,
          language: cached.language,
          code_snippet: cached.code_snippet,
          cached: true,
          created_at: cached.created_at,
        });
      }
    }

    // 2. Not cached: Generate using Gemini API
    const html = await generateVisualization({
      topic: cleanTopic,
      language: cleanLang,
      code: code || '',
      lessonTitle: lesson_title || '',
    });

    // 3. Save to user_visualizations in database
    let savedId = null;
    try {
      const [insertRes] = await pool.query(
        'INSERT INTO user_visualizations (user_id, topic, language, code_snippet, html_content) VALUES (?, ?, ?, ?, ?)',
        [userId, cleanTopic, cleanLang, code || null, html]
      );
      savedId = insertRes.insertId;
    } catch (saveErr) {
      console.warn('Could not save visualization to database:', saveErr.message);
    }

    return respondSuccess(res, {
      id: savedId,
      html,
      topic: cleanTopic,
      language: cleanLang,
      cached: false,
    });
  } catch (err) {
    console.error('Visualization generation error:', err);
    return respondError(res, `failed to generate visualization: ${err.message}`, 500);
  }
});

// GET /api/v1/visualizations (history list of questions)
v1Router.get('/visualizations', ensureAuthenticated, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, topic, language, created_at 
       FROM user_visualizations 
       WHERE user_id = ? 
       ORDER BY id DESC 
       LIMIT 50`,
      [req.user.id]
    );
    return respondSuccess(res, rows);
  } catch (err) {
    console.error('Error fetching visualizations:', err);
    return respondError(res, `failed to load visualizations: ${err.message}`, 500);
  }
});

// GET /api/v1/visualizations/:id (single saved visualization)
v1Router.get('/visualizations/:id', ensureAuthenticated, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, topic, language, code_snippet, html_content, created_at 
       FROM user_visualizations 
       WHERE id = ? AND user_id = ? 
       LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return respondError(res, 'visualization not found', 404);
    }
    return respondSuccess(res, rows[0]);
  } catch (err) {
    console.error('Error fetching visualization detail:', err);
    return respondError(res, `failed to load visualization: ${err.message}`, 500);
  }
});

// DELETE /api/v1/visualizations/:id (delete saved visualization)
v1Router.delete('/visualizations/:id', ensureAuthenticated, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_visualizations WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    return respondSuccess(res, { deleted: true, id: req.params.id });
  } catch (err) {
    console.error('Error deleting visualization:', err);
    return respondError(res, `failed to delete visualization: ${err.message}`, 500);
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
