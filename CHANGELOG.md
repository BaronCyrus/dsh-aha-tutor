# Changelog

All notable changes to this plugin are recorded here. Versions follow [SemVer](https://semver.org/); GitHub Release notes for each version live in `docs/releases/`.

## 1.0.0 - 2026-10-18

First release.

### Added

- **Craft a course**: start from a sentence or uploaded materials; an intake of multiple-choice questions about background, goal, depth and time; an editable unit → chapter → lesson blueprint that can also be revised by request; confirming generates practice sets and hands-on projects for the whole course.
- **Whiteboard classroom**: lessons are step scripts (headings, text, KaTeX math, lists, sanitized SVG diagrams, data charts, tables, code, notes, marks and sandboxed animations) played with handwriting reveal synchronized to narration and captions; play and pause (Space), step back and forward (← →), speed, resume from the saved position, a pencil that follows the handwriting and a Markdown export of the board.
- **Adaptive checks**: in-lesson checks with a confidence prompt; a Bayesian knowledge-tracing mastery model that weighs confidence, hints and hesitation; remedial lessons inserted after a lesson for concepts below threshold; challenge suggestions for strong learners.
- **Ask and re-explain**: questions mid-lesson are answered on the board right after the current step, then the lesson resumes; re-explain a step by analogy, drawing, example, simpler or deeper.
- **Practice and review**: per-lesson practice with objective auto-grading and model-graded open answers against key points; flashcards and concepts on an SM-2 spaced-repetition schedule; a study planner that respects weekly time, study days and deadlines and flags deadline risk.
- **Materials**: PDF (pdf.js, with CJK radical repair), Word (.docx), PowerPoint (.pptx), Markdown and text (UTF-8, with a GB18030 fallback), public web pages (Readability, with private-address refusal) and images for vision models; BM25 retrieval with CJK bigrams; page citations; reading digests.
- **Studio**: explain a concept, solve with me, show me visually, topic cheat sheets (columns, font size, highlighting, print), notes, flashcard decks, quizzes and two-minute explainer shorts from a topic or a link.
- **Video export**: any lesson or short renders to a 1280×720 WebM video in the board's theme, with handwriting, captions (no line starts with closing punctuation), a watermark and, with a cloud voice, narration audio. Animations carry an SVG poster frame that stands in for them in videos.
- **Projects**: each project gets a folder with its brief and starter files under `~/AhaTutor/projects/` that opens as a DSH workspace session; existing files are never overwritten. Submissions (notes plus the folder's text files) get a rubric review.
- **Learner profile**: background, goals, preferences and weak spots remembered across courses, with view, edit and clear.
- **Conversation preset** "开窍 · AI 私人老师" with tools `aha_whiteboard`, `aha_quiz`, `aha_course`, `aha_cheatsheet` and `aha_learner`, rendered as cards in the chat; boards open in the right sidebar.
- **Voices**: browser speech by default with per-language voice choice; optional cloud TTS from OpenAI-compatible APIs, Volcengine (Doubao), MiniMax and Azure Speech, with keys in DSH's credential store and a local audio cache.
- **Models**: DSH's default model, with separate overrides for "course design & teaching" and "grading & questions"; vision detection for image materials.
- **Course packs**: export and import `.aha-course.json` packs; two bundled sample courses (harmonic motion, Bayesian thinking).
- **In-plugin update**: checks the registry and installs an exact version with DSH's bundled pnpm in the owning profile; versions inside pnpm's release-age window are reported as pending; `link:` installs are left alone.
- Chinese and English interface; light and dark themes; macOS and Windows support.
