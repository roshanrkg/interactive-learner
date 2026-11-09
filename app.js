const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 8081; 

// Standard Middlewares
app.use(cors());
app.use(express.json());

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

// ==========================================
// API v1 Routes
// ==========================================
const v1Router = express.Router();

// GET /api/v1/courses/:slug/syllabus
v1Router.get('/courses/:slug/syllabus', async (req, res) => {
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
v1Router.get('/lessons/:slug', async (req, res) => {
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
v1Router.post('/quizzes/verify', async (req, res) => {
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

// POST /api/v1/quizzes/verify
v1Router.post('/quizzes/verify', async (req, res) => {
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
// Static Assets & SPA Fallback
// ==========================================
app.use('/static', express.static(path.join(__dirname, 'static')));

// Fallback to index.html for client-side routing (equivalent to Gin's NoRoute)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
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
  });
}

module.exports = app;
