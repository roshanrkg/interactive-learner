const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { SystemMessage, HumanMessage } = require('@langchain/core/messages');
require('dotenv').config();

// Initialize lightweight Gemini model
const model = new ChatGoogleGenerativeAI({
  model: 'gemini-flash-lite-latest',
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.2,
});

const SYSTEM_PROMPT = `You are an expert educational coding visualizer engineer.
Your task is to generate a beautiful, modern, and interactive step-by-step visual demonstration for algorithms, data structures, and coding concepts.

STRICT TECHNICAL RULES:
1. Output MUST be ONLY valid, self-contained HTML (with embedded <style> and <script>).
2. Use Tailwind CSS for modern aesthetics via:
   <script src="https://cdn.tailwindcss.com"></script>
3. Include interactive controls:
   - "▶ Play / ⏸ Pause" button with automatic step progression timer
   - "⏭ Step Forward" button
   - "⏮ Step Backward" or "🔄 Reset" button
   - A speed slider or toggle (optional, for great UX)
4. Visual Layout:
   - Modern, clean, and rounded card aesthetic (matching purple/indigo/slate card design with Tailwind).
   - Visual items: large, rounded boxes/nodes for data elements (e.g., arrays, pointers, stack frames, lists) with values and sub-indices clearly labeled.
   - Distinct active/highlight states: animate the current pointer, active index, or comparison with vibrant colors (e.g. ring-4 ring-indigo-400 or emerald green).
   - A "State Inspector / Console Box" showing current variable states, step explanation, and loop condition in real time.
5. NO REACT, NO VUE, NO SVELTE, NO JSX, NO WEBPACK, NO EXTERNAL MODULE IMPORTS.
   - Use ONLY pure, vanilla HTML, CSS, and JavaScript inside a single <script> block.
   - Attach event listeners cleanly to DOM IDs.
6. The HTML must fit cleanly and look great inside an iframe (min-height: 480px, responsive).
7. Return raw HTML directly. Do not wrap in conversational markdown prose outside of the HTML code block.`;

/**
 * Generates an interactive HTML visualizer using Gemini Flash Lite
 */
async function generateVisualization({ topic, language = 'Python', code = '', lessonTitle = '' }) {
  let prompt = `Create an interactive step-by-step visualizer for:
Topic: ${topic}
Programming Language: ${language}`;

  if (lessonTitle) {
    prompt += `\nLesson Context: ${lessonTitle}`;
  }
  if (code) {
    prompt += `\nReference Code Snippet:\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\``;
  }

  prompt += `\n\nEnsure there are clear interactive buttons (Play, Step Forward, Reset) and an animated visual representation of the concept.`;

  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(prompt),
  ]);

  // Safely extract string content whether Gemini returns a raw string or an array of content parts
  let html = '';
  if (typeof response.content === 'string') {
    html = response.content;
  } else if (Array.isArray(response.content)) {
    html = response.content
      .map((part) => (typeof part === 'string' ? part : part.text || ''))
      .join('');
  } else if (response.content && typeof response.content === 'object' && response.content.text) {
    html = response.content.text;
  } else {
    html = String(response.content || '');
  }

  // Clean markdown code blocks if returned
  if (typeof html === 'string') {
    html = html.trim();
    if (html.startsWith('```html')) {
      html = html.replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim();
    } else if (html.startsWith('```')) {
      html = html.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    }
  }

  return html;
}

module.exports = {
  generateVisualization,
};
