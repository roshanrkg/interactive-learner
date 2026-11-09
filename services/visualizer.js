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
2. Mobile First & 100% Fluid Width (CRITICAL):
   - Must include <meta name="viewport" content="width=device-width, initial-scale=1.0"> in <head>.
   - Must use w-full and max-w-full. DO NOT use fixed pixel widths or restrictive max-w-sm / max-w-md that clip on mobile screens.
   - For Array / Node / Data element rows:
     * MUST wrap the array container in an overflow-x-auto container: <div class="w-full overflow-x-auto py-2 flex items-center justify-start sm:justify-center gap-2 sm:gap-3 px-2">.
     * DO NOT use justify-center without overflow-x-auto, because when items overflow narrow mobile screens, items on the left get cut off. Always use "justify-start sm:justify-center overflow-x-auto".
     * Nodes / Array boxes should be compact and responsive: "w-11 h-11 sm:w-16 sm:h-16 min-w-[2.75rem] text-sm sm:text-lg font-bold rounded-xl" so multiple items fit side-by-side on mobile without horizontal overflowing.
   - All buttons and controls must use a clean responsive layout (e.g. "grid grid-cols-3 gap-2 w-full max-w-xs mx-auto" or "flex flex-wrap justify-center gap-2") with "px-3 py-2 text-xs sm:text-sm font-semibold".
   - Generous mobile padding: Add pb-8 inside body so bottom elements are never cramped.
3. Use Tailwind CSS for modern aesthetics via:
   <script src="https://cdn.tailwindcss.com"></script>
4. Include interactive controls:
   - "▶ Play / ⏸ Pause" button with automatic step progression timer
   - "⏭ Step Forward" button
   - "🔄 Reset" button
5. Visual Layout:
   - Modern, clean, and rounded card aesthetic (matching dark slate or indigo card design with Tailwind).
   - Visual items: rounded boxes/nodes for data elements (e.g., arrays, pointers, stack frames, lists) with values and sub-indices clearly labeled.
   - Distinct active/highlight states: animate the current pointer, active index, or comparison with vibrant colors.
   - A "State Inspector / Console Box" showing current variable states, step explanation, and loop condition in real time.
6. NO REACT, NO VUE, NO SVELTE, NO JSX, NO WEBPACK, NO EXTERNAL MODULE IMPORTS.
   - Use ONLY pure, vanilla HTML, CSS, and JavaScript inside a single <script> block.
   - Attach event listeners cleanly to DOM IDs.
7. The HTML must fit cleanly and look great inside an iframe (min-height: 480px, fully responsive).
8. Return raw HTML directly. Do not wrap in conversational markdown prose outside of the HTML code block.`;

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
