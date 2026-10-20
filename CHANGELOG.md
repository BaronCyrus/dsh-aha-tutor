# Changelog

All notable changes to this plugin are recorded here. Versions follow [SemVer](https://semver.org/); GitHub Release notes for each version live in `docs/releases/`.

## Unreleased

### Added

- **Web research before a course**: a new course can start by looking the subject up with DSH's web search (on by default, off when materials are attached, switchable on the home page). A few searches are made, and what comes back informs the questions and the blueprint. The course page lists the sources under **Sources**. When DSH cannot search, for example without a DeepSeek key, the course is designed as before and the questionnaire says why.
- **Plan calendar with ticks**: the plan page shows a month calendar; past days keep what was planned and what came of it. Finishing a lesson or a review ticks it on its own, and today's or an earlier day's items can be ticked or unticked by hand, here and on the home page. A lesson ticked by hand counts as done, and the days ahead are planned again; time already studied today comes off today's list instead of pulling the next lesson in.
- **Live lesson preparation**: when preparing a lesson takes more than three seconds, the board shows what the teacher is doing instead of a spinner: thinking the lesson through (for a model that thinks first, with how much it has thought), then writing step N with that step's heading appearing as it is written, how many steps are ready and the seconds so far. When the lesson catches up with the writing, it shows the step being written.
- **Board export as PDF and pictures**: **Export board** in a lesson or a short now offers a PDF with one board page per page, a PNG picture per page (several pages come as a ZIP) and the Markdown text as before. The pages are drawn from the board itself, so they keep the handwriting font, formulas, highlights, marks and the questions asked in class, in the board look chosen in Settings.

### Changed

- **Lessons start in a second or two.** Lesson boards (prefetched ones too), re-explanations, instant answers and explainer shorts no longer wait for the model to think first: they ask for no reasoning where the model can turn it off (DeepSeek, for one) and for the model's lightest effort otherwise (low for Claude 5.5, minimal for GPT-5). With DeepSeek-V4.1-Flash, three lessons started 1–2 seconds after they were opened instead of 25–77 seconds, and their boards kept the same shape: hook, figures, a worked example, a written-working check and a recap.

### Fixed

- A board could stop in the middle of a step when the model's reasoning used up the output limit (DeepSeek at low effort once thought 40,000 characters before a lesson). A low effort now gets 16k tokens of room for its reasoning instead of 8k.
- On a narrow board, the small "preparing" notice stays on one line instead of breaking after a few characters.
- **Formulas render as KaTeX meant them again.** The plugin bundled KaTeX 0.16 while DSH 0.2.1 styles formulas with KaTeX 0.18.7's stylesheet, which renamed its layout classes, so superscripts and subscripts were drawn at full size and stacked symbols such as ≠ came apart. The bundled KaTeX is now 0.18.7, and a test keeps the two in step.
- **A crash no longer blanks the plugin.** Anything that went wrong while showing a screen left the whole plugin page blank, and because the plugin reopens the last screen, it stayed blank after a reload, with no way to reach Settings. The screen now shows a short notice with **Retry** and **Back to home** while the navigation keeps working, and the next visit starts at home instead of reopening it. The board tab and the cards in a conversation show the notice with **Retry** in place of the part that failed, instead of DSH swapping them out until it reloads.
- Dashed lines in board figures (guide lines, heights) stay dashed after they are drawn instead of turning solid.
- A highlight may contain a single "=", so `==乘积 = 0==` is highlighted instead of showing its marks.

## 1.3.0 - 2026-10-19

### Added

- **Show your working**: a lesson with a calculation or derivation asks once for the whole working, typed with a live math preview. The grader finds the first line that goes wrong, and the teacher corrects it on the board, starting from that line. The correction stays with the lesson and appears in the transcript.
- **Course size and a visible build**: the questionnaire asks how big the course should be (let the teacher decide, short 3–8, standard 10–20 or full 25–45 lessons). While the blueprint is written you see the steps and the outline growing unit by unit.
- **Blueprint editing**: split a lesson in two or take it deeper with one click; deleting a unit, a chapter or a started lesson asks first; and **Edit outline** in a course's ⋯ menu reopens the editor after the course has started, with **Ask for one more unit**. Progress on lessons that stay is kept.
- **Practice**: items can carry a figure (drawn through the SVG allow-list), a round ends with stars, accuracy, the best streak, how each concept moved and one next step, the current streak shows while you answer, and the keyboard works (1–4 to choose, Enter to submit or continue, H for a hint).
- **Course page**: concepts show five stages (not started, weak, learning, proficient, mastered), and a **Next step** card suggests due reviews first, then the weakest concept, then the next lesson.

### Fixed

- **Reasoning models no longer cut lessons and shorts short.** At its default effort a reasoning model (DeepSeek through DSH or a relay, among others) could spend the whole output limit thinking, so a short stopped after two steps ("came back too short") or came back empty (`EMPTY_RESPONSE`). Boards, shorts, re-explanations and quick answers now ask for a low reasoning effort, every call leaves room for its reasoning within the model's limit, and an answer lost to reasoning is retried with more room. Model errors in the classroom and on checks now show in your language.

### Changed

- **AI changes to a blueprint are proposals**: the editor lists the lessons added, removed, renamed and changed, and nothing changes until you apply them.
- Mastery meters stay empty until there is evidence; an untouched concept no longer lights a segment. **Start review** on a course page reviews that course only.
- Plans and today's list name a course by its emoji and main title (the part before a colon), with the full title on hover.

## 1.2.0 - 2026-10-19

### Added

- **Handwriting board font**: the board writes in LXGW WenKai GB (Chinese) and Caveat (Latin), bundled as OFL subsets (GB 2312 and CJK punctuation, about 1.8 MB) and fetched slice by slice through a new `/api/aha-tutor/font` route, with the system stack as the fallback; the slices a board needs are fetched before the pencil reaches them, and exported videos use the same font. Settings → board font switches between handwriting and the app's standard font.
- **The board follows the narration sentence by sentence**: new lessons tag each board item with the sentence it belongs to, so it is written when that sentence is spoken and highlighted while it is being talked about. Older boards keep their pacing. Exported videos follow the same timing.
- **Side panel in the classroom**: the lesson's goals with progress (new lessons tag each step with the goal it serves), a transcript of what has been said with your questions and re-explanations (click a line to go back to it), and the ask box. It folds away, and drops below the board on narrow screens.

### Fixed

- **Web import** no longer reaches this computer or the local network through other spellings of an address (`localhost.`, `[::ffff:127.0.0.1]`, IPv6 link-local, shared and reserved ranges, `*.internal`) or through a public name that resolves to a private address: every resolved address is checked when the connection is made, each redirect hop is checked again, and the page size is capped while it downloads. Import errors are translated.
- **Leaving a screen no longer cancels its generation.** Blueprints, course confirmation, lesson boards, practice, cheat sheets and digests keep running in the background and are picked up when you come back; long waits show a cancel button instead. A cancelled job reads as cancelled, not failed.
- **Long documents are read in full.** A digest reads the whole document part by part and combines the notes (failed parts are retried once, and any still missing are named in the digest with a "Digest again" button); the summary used for course design samples the whole document instead of its first pages.
- **Captions** show the sentence being spoken, with formulas typeset; narration speaks formulas as readable text instead of raw TeX.
- **Raised-hand answers and re-explanations** appear on the board while they are written, stay with the lesson (replayed where they were asked when you come back), and show up in the side panel's transcript. The saved position now counts the lesson's own steps.
- **Confirming a course is quicker**: it prepares the projects and the first unit's practice; a later lecture gets practice for all its lessons when one of them is first opened or practised, with room for every lesson. The blueprint step shows how many lessons have been written so far.
- **Sample course**: the first lesson of the Bayes sample writes the set {2, 4, 6} as a formula instead of showing stray backslashes.

## 1.1.0 - 2026-10-19

### Added

- **About the author** page at the bottom of the navigation: author, a short note, links to the GitHub repository and issues, and the WeChat and Alipay tip codes (bundled as data URLs, so the page works offline).

### Changed

- The English label of 「我的画像」 is now "My profile", so it no longer reads like the new About page.

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
