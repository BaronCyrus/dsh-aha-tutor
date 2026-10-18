// Prompt builders. Each returns { system, user } text for one model call.
// Structured answers are JSON (or JSON Lines for streamed lesson boards);
// the host repairs and normalizes them, so the prompts optimize for teaching
// quality first and format second.

const LANGUAGE_NAMES = Object.freeze({
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
})

export function languageName(code) {
  if (LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code]
  const base = String(code ?? '').split('-')[0]
  return LANGUAGE_NAMES[base] ?? (code ? String(code) : 'the learner\'s language')
}

// Course content follows the language the learner wrote in.
export function detectLanguage(textValue, fallback = 'zh-CN') {
  const value = String(textValue ?? '')
  if (/[\u3040-\u30ff]/u.test(value)) return 'ja'
  if (/[\uac00-\ud7af]/u.test(value)) return 'ko'
  if (/[\u4e00-\u9fff]/u.test(value)) return 'zh-CN'
  if (/[a-z]{3,}/iu.test(value)) return 'en'
  return fallback
}

const PERSONA = `You are Aha, a brilliant and warm private tutor who teaches one learner at a time. You explain like the best teacher the learner ever had: you start from intuition or a concrete puzzle, build ideas step by step, check understanding often, and adapt to the learner instead of reciting a textbook. You never invent facts; when unsure you say so.`

const JSON_ONLY = 'Reply with JSON only: no code fences, no comments, no text before or after.'
const JSONL_ONLY = 'Reply with JSON Lines only: one compact JSON object per line, nothing else — no code fences, no numbering, no blank commentary lines. Escape newlines inside strings as \\n.'

function languageRule(language) {
  return `Write every learner-facing string (narration, board text, questions, options, explanations) in ${languageName(language)}. Keep standard notation — math, code, units, proper names — as is.`
}

function block(label, content) {
  const value = typeof content === 'string' ? content.trim() : content ? JSON.stringify(content, null, 1) : ''
  return value ? `<${label}>\n${value}\n</${label}>` : ''
}

function join(...parts) {
  return parts.filter(Boolean).join('\n\n')
}

function learnerBlock({ profile, mastery } = {}) {
  const lines = []
  if (profile?.background) lines.push(`Background: ${profile.background}`)
  if (profile?.goals?.length) lines.push(`Goals: ${profile.goals.join('; ')}`)
  if (profile?.preferences?.style) lines.push(`Prefers explanations that are: ${profile.preferences.style}`)
  if (profile?.strengths?.length) lines.push(`Strengths: ${profile.strengths.join('; ')}`)
  if (profile?.weaknesses?.length) lines.push(`Known weak spots: ${profile.weaknesses.join('; ')}`)
  for (const note of (profile?.notes ?? []).slice(-6)) lines.push(`Note: ${note.text}`)
  if (mastery?.length) {
    lines.push('Mastery of related concepts (0–100):')
    for (const row of mastery) {
      lines.push(`- ${row.concept}: ${row.mastery}${row.misconceptions?.length ? ` (misconceptions: ${row.misconceptions.join('; ')})` : ''}${row.fragile ? ' (fragile)' : ''}`)
    }
  }
  return lines.length ? block('learner', lines.join('\n')) : ''
}

// ── whiteboard format ───────────────────────────────────────────────────────

export const BOARD_SPEC = `THE WHITEBOARD
The board has two columns and is written by hand while you speak. Put on it only what deserves to stay visible: headings, key phrases, formulas, diagrams, worked steps. Say the rest aloud.

Board operations (each is a JSON object with field "t"; give an op an "id" only if you will refer to it later):
- {"t":"title","text":"…"}  page title, once per page
- {"t":"h","text":"…"}  short section heading
- {"t":"p","text":"…"}  one to three short lines; inline math $…$, **bold**, ==highlight==
- {"t":"math","tex":"…","text":"…"}  one display formula in KaTeX-compatible LaTeX; "text" is a plain-Unicode reading of it (e.g. "θ(t) = θ₀·cos(ωt + φ)")
- {"t":"list","items":["…","…"],"ordered":false}
- {"t":"svg","svg":"<svg viewBox=\\"0 0 480 300\\" xmlns=\\"http://www.w3.org/2000/svg\\">…</svg>","caption":"…"}  a clean hand-drawn-style diagram: viewBox at most 640×420, strokes and simple shapes, <text> labels (font-size 14–18), colors only from ink #2b2b2b, blue #2f6fde, red #d64545, green #2f9e6e, orange #e08a1e, purple #7a4fd6; no scripts, no images, no foreignObject, no external links
- {"t":"chart","kind":"line|bar|scatter|pie|area","title":"…","xLabel":"…","yLabel":"…","series":[{"name":"…","points":[[x,y],…]}]}  or "data":[{"label":"…","value":n}] for bar/pie; use real, computed numbers
- {"t":"table","head":["…"],"rows":[["…","…"]]}
- {"t":"code","lang":"python","code":"…"}
- {"t":"note","tone":"key|tip|warn|example","text":"…"}  boxed takeaway or warning
- {"t":"mark","ref":"<id of an earlier op>","style":"underline|circle|box"}  point back at something already written
- {"t":"anim","html":"<!doctype html>…","height":300,"caption":"…","poster":"<svg …>…</svg>"}  only when motion is the point (orbits, waves, sorting); a self-contained page under 8 KB using canvas or SVG and plain JavaScript, no network access, starts automatically and loops; "poster" is one representative still frame as an SVG with the same rules as svg ops, shown where the animation cannot play (exported videos)
- {"t":"col"}  continue in the right column;  {"t":"page","title":"…"}  wipe the board and start a new page

Fill the left column, then {"t":"col"}, then the right column; start a new page when both are full (roughly 8–12 ops per page).`

export const STEP_SPEC = `Each output line is ONE teaching step:
{"say":"what you say while writing — natural spoken sentences, 1–4 sentences, no markdown","ops":[ …board ops written during this step… ],"check":{ …optional quick question… }}

A check is a short question asked right after the step, to see whether the idea landed:
{"kind":"choice|multi|blank|number|short","prompt":"…","options":["…","…"],"answer":<option index (0-based) for choice, list of indexes for multi, accepted strings for blank, a number for number, a model answer for short>,"tolerance":<number, for number>,"explanation":"why the answer is right, in one or two sentences","conceptIds":["<ids from the concept list>"]}
Make wrong options plausible (common mistakes), never trick questions.`

// ── course crafting ─────────────────────────────────────────────────────────

export function questionnairePrompt({ goal, language, materialsSummary, profile }) {
  return {
    system: join(PERSONA, `Before designing a course you ask a few sharp questions, the way a good tutor does in a first meeting. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('learning_goal', goal),
      block('materials', materialsSummary),
      learnerBlock({ profile }),
      `Write 3 to 5 multiple-choice questions whose answers would most change how you design this particular course. Typical topics: why they want to learn it (exam, job, project, curiosity), what they already know, how much time they have and by when, how they like to learn, and which applied project or focus area they care about. Skip anything already clear from the goal, the materials or the learner notes. Make every option concrete and specific to this subject (not generic), with a short detail line. 3–5 options each; set "multi": true only when several answers can apply.

Return {"questions":[{"prompt":"…","topic":"purpose|level|timeline|style|focus|other","multi":false,"options":[{"label":"…","detail":"…"}]}]}`,
    ),
  }
}

// The pace bounds a broad subject; a narrow goal or a stated time budget sets
// the size itself, so a twenty-minute question never becomes a semester.
function sizeGuidance(timeline) {
  const broad = timeline === 'intensive'
    ? 'Intensive pace: for a broad subject, up to 4–6 units and 18–30 lessons, focused on what matters most for the goal.'
    : timeline === 'relaxed'
      ? 'No fixed deadline: for a broad subject, up to 6–10 units and 35–70 lessons, with room for depth, connections and enrichment.'
      : 'Balanced pace: for a broad subject, up to 5–8 units and 26–45 lessons, covering foundations, practice and an applied project.'
  return `Size the course to the goal first. When the goal is a single idea or names a time budget ("in 20 minutes", "one evening", "this weekend"), fit it: one unit with a single lecture of 1–4 lessons can be the whole course. Never pad with filler lessons. ${broad}`
}

export function blueprintPrompt({ goal, language, intake, materialsSummary, profile, timeline, weeklyMinutes }) {
  return {
    system: join(PERSONA, `You design personal courses with the care of an experienced curriculum designer: clear prerequisites first, one new idea per lesson, frequent practice, and applied projects that make the knowledge usable. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('learning_goal', goal),
      block('intake_answers', intake),
      block('materials', materialsSummary),
      learnerBlock({ profile }),
      `Design the course blueprint.
- ${sizeGuidance(timeline)}${weeklyMinutes ? ` The learner can study about ${weeklyMinutes} minutes per week.` : ''}
- Structure: units → lectures (1–5 per unit) → lessons (1–5 per lecture). Each lesson takes 10–25 minutes and teaches one coherent idea.
- Order lessons so every prerequisite comes first. Start from where the learner is, not from zero if they already know the basics.
- If materials were provided, follow their scope and order where sensible.
- Each lesson lists 1–3 learning objectives (observable: "compute…", "explain why…") and 1–4 key concepts (short names).
- Add 1–3 projects (one is enough for a short course) that apply the course to something real for this learner, placed after the units they depend on. Use "kind":"code" only when the project is mainly programming or data work.
- Pick one emoji that fits the subject.

Return {"title":"…","subtitle":"one line promise of the course","emoji":"…","summary":"2–3 sentences: who it is for, what they will be able to do","level":"beginner|intermediate|advanced","units":[{"title":"…","summary":"…","objectives":["…"],"lectures":[{"title":"…","summary":"…","lessons":[{"title":"…","summary":"…","objectives":["…"],"concepts":["…"],"estMinutes":15}]}]}],"projects":[{"title":"…","kind":"code|writing|analysis|design|practice|other","brief":"…","skills":["…"],"unitIndex":<0-based unit after which it fits>,"milestones":["…"],"rubric":[{"criterion":"…","points":10}]}]}`,
    ),
  }
}

export function revisePrompt({ blueprint, instruction, language }) {
  return {
    system: join(PERSONA, `You revise course blueprints precisely as asked, keeping everything else intact. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('current_blueprint', blueprint),
      block('change_request', instruction),
      'Apply the change request and return the complete revised blueprint in the same JSON shape. Keep the "id" field of every unit, lecture, lesson and concept you do not substantially change; new items get no id.',
    ),
  }
}

export function practicePrompt({ course, lecture, lessons, language, passages }) {
  const lessonLines = lessons.map(lesson => `- [${lesson.id}] ${lesson.title}: ${lesson.objectives.join('; ')} | concepts: ${lesson.concepts.map(concept => `${concept.id}=${concept.name}`).join(', ')}`).join('\n')
  return {
    system: join(PERSONA, `You write practice that builds real understanding: retrieval, application, and common-mistake traps, from easy to harder. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('course', `${course.title} — ${course.summary ?? ''}`),
      block('lecture', lecture.title),
      block('lessons', lessonLines),
      block('source_passages', passages),
      `For EACH lesson write 4–6 practice items. Mix kinds: "choice" (4 options), "multi", "blank" (short exact answer; list accepted spellings), "number" (with tolerance), "short" (a sentence or two, with a model answer and 2–3 rubric points). At least one item per lesson asks the learner to apply the idea to a new situation. Give each item 1–2 hints that nudge without giving the answer, an explanation, a difficulty 1–3, and the conceptIds it tests (use the ids given).

Return {"lessons":{"<lesson id>":{"items":[{"kind":"choice","prompt":"…","options":["…"],"answer":0,"hints":["…"],"explanation":"…","difficulty":1,"conceptIds":["…"]}]}}}`,
    ),
  }
}

export function projectsPrompt({ course, projects, language }) {
  return {
    system: join(PERSONA, `You turn project ideas into briefs a learner can actually start today. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('course', `${course.title} — ${course.summary ?? ''}`),
      block('outline', course.outline),
      block('projects', projects.map(project => ({ id: project.id, title: project.title, kind: project.kind, brief: project.brief }))),
      `Expand every project: a motivating brief (the scenario, the deliverable, what "done" looks like), 3–6 milestones with details, a rubric (4–6 criteria with points summing to 100 and what earns full marks), and the skills it exercises. For "code" projects also include starter files: a README.md with instructions, a main script with TODOs (not the solution), and a small realistic sample dataset when data is involved (CSV under 200 rows). Use relative paths only.

Return {"projects":[{"id":"<same id>","title":"…","kind":"…","brief":"…","skills":["…"],"milestones":[{"title":"…","detail":"…"}],"rubric":[{"criterion":"…","points":20,"detail":"…"}],"starterFiles":[{"path":"README.md","content":"…"}]}]}`,
    ),
  }
}

// ── lessons ─────────────────────────────────────────────────────────────────

const DIRECTIVES = Object.freeze({
  remediate: 'This is a REMEDIAL lesson: the learner struggled with these concepts. Re-teach them from a different angle than before (new analogy, picture, or worked example), name and dismantle the specific misconceptions listed, and check understanding more often (a check every 2 steps).',
  challenge: 'The learner has mastered the prerequisites easily: move briskly through basics, add depth (why it works, edge cases, connections) and make the checks harder.',
  review: 'This is a REVIEW lesson: retrieve before re-explaining. Open with a question, then consolidate the key ideas with a compact board and mixed checks.',
})

export function lessonPrompt({ course, unit, lecture, lesson, language, learner, passages, previous, directive, style }) {
  const steps = Math.min(18, Math.max(7, Math.round((lesson.estMinutes || 15) * 0.7)))
  return {
    system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
    user: join(
      block('course', `${course.title} (${course.level || 'mixed level'}) — ${course.summary ?? ''}`),
      block('position', `Unit: ${unit.title}\nLecture: ${lecture.title}\nLesson: ${lesson.title}\nObjectives: ${lesson.objectives.join('; ')}\nConcepts (id=name): ${lesson.concepts.map(concept => `${concept.id}=${concept.name}`).join(', ')}`),
      block('previous_lesson', previous),
      learnerBlock(learner),
      block('source_passages', passages),
      style ? block('style_request', style) : '',
      DIRECTIVES[directive] ?? '',
      `Teach this lesson in about ${steps} steps (~${lesson.estMinutes || 15} minutes).
- Open with a hook: a question, a surprising fact, or a concrete situation the idea explains. Connect to the previous lesson when there is one.
- Build intuition before formalism; then make it precise; then work at least one example fully on the board.
- Draw a diagram or chart whenever a picture makes the idea click.
- Put 2–4 checks after the key ideas, plus one at the end; every check must name its conceptIds.
- If source passages are given, stay consistent with them and mention the page when you lean on one.
- Close with a recap step: a "key" note with the 2–3 takeaways, and say what comes next.
Start with a step whose ops begin with {"t":"title","text":"${lesson.title.replace(/"/gu, '\\"')}"}.`,
    ),
  }
}

export function askPrompt({ course, lesson, language, boardSoFar, question, learner }) {
  return {
    system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
    user: join(
      block('course', course ? `${course.title}` : ''),
      block('lesson', lesson ? `${lesson.title}: ${lesson.objectives?.join('; ') ?? ''}` : ''),
      block('board_so_far', boardSoFar),
      learnerBlock(learner),
      block('learner_question', question),
      `The learner raised a hand with this question in the middle of the lesson. Answer it at the board in 1–4 steps: start with {"t":"page","title":"…"} only if the answer needs a fresh board, otherwise keep writing. Be direct, use a small example or picture if it helps, and connect back to where the lesson was. If the question reveals a misunderstanding, address it kindly and end with one quick check. Do not continue the lesson itself.`,
    ),
  }
}

const REEXPLAIN_STYLES = Object.freeze({
  analogy: 'with an everyday analogy that maps closely onto the idea',
  visual: 'mainly with a diagram or chart, explaining what each part of the picture means',
  example: 'through a concrete worked example with real numbers, step by step',
  simpler: 'more simply, with shorter sentences, no jargon, and smaller steps',
  deeper: 'more rigorously, showing why it is true and where it breaks down',
})

export function reexplainPrompt({ lesson, language, step, boardSoFar, style }) {
  return {
    system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
    user: join(
      block('lesson', lesson ? lesson.title : ''),
      block('board_so_far', boardSoFar),
      block('step_to_reexplain', step),
      `The learner did not get this step. Explain the same idea again ${REEXPLAIN_STYLES[style] ?? REEXPLAIN_STYLES.example}, in 2–4 steps, starting with {"t":"page","title":"…"}. End with one quick check.`,
    ),
  }
}

export function gradePrompt({ item, response, language }) {
  return {
    system: join(PERSONA, `You grade open answers fairly: credit correct ideas expressed in the learner's own words, ignore spelling and phrasing, and pinpoint the exact gap. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('question', item.prompt),
      block('model_answer', item.answer),
      block('rubric', (item.rubric ?? []).join('\n')),
      block('learner_answer', response),
      'Return {"score":<0 to 1>,"verdict":"correct|partial|incorrect","feedback":"2–3 encouraging sentences: what is right, what is missing, how to fix it","errorTag":"<3–6 word label of the main mistake, or empty>","misconception":<true if the answer shows a confident wrong belief rather than a gap>}',
    ),
  }
}

export function projectReviewPrompt({ project, submission, language }) {
  return {
    system: join(PERSONA, `You review learner projects like a supportive senior mentor: specific, honest, and actionable. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('project', { title: project.title, brief: project.brief, milestones: project.milestones, rubric: project.rubric }),
      block('submission', submission),
      'Score each rubric criterion (0 to its points) with a one-sentence justification that quotes or points to the submission. Then summarize strengths and the 2–4 most valuable next improvements.\n\nReturn {"scores":[{"criterionId":"r1","points":0,"comment":"…"}],"total":0,"summary":"…","strengths":["…"],"nextSteps":["…"]}',
    ),
  }
}

// ── study materials ─────────────────────────────────────────────────────────

export function cheatsheetPrompt({ scopeTitle, outline, passages, language, focus }) {
  return {
    system: join(PERSONA, `You make dense, exam-ready cheat sheets that a student can print on one or two pages. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('scope', scopeTitle),
      block('outline', outline),
      block('source_passages', passages),
      block('focus', focus),
      `Write a cheat sheet organized by THEME (not by chapter): group what belongs together even if it was taught in different places, and link related sections. Items are terse: definitions, formulas (LaTeX in "tex"), key facts, worked mini-examples, comparisons, and common pitfalls. Cite the page or slide when an item comes from a source passage. 6–14 sections, 3–10 items each.

Return {"title":"…","sections":[{"title":"…","related":["<other section title>"],"items":[{"kind":"definition|formula|fact|tip|pitfall|example|compare","title":"…","text":"…","tex":"…","cite":{"page":12,"source":"…"}}]}]}`,
    ),
  }
}

export function flashcardsPrompt({ scopeTitle, outline, passages, language, count = 24 }) {
  return {
    system: join(PERSONA, `You write flashcards that test one fact or idea each, phrased as questions that force recall. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('scope', scopeTitle),
      block('outline', outline),
      block('source_passages', passages),
      `Write ${count} flashcards covering the most important ideas, definitions and formulas. Fronts are short questions or prompts; backs are precise answers (LaTeX allowed as $…$), at most three sentences. Avoid yes/no fronts.

Return {"cards":[{"front":"…","back":"…","tag":"<topic>"}]}`,
    ),
  }
}

export function quizPrompt({ scopeTitle, outline, concepts, language, count = 10 }) {
  return {
    system: join(PERSONA, `You write fair, well-balanced quizzes. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('scope', scopeTitle),
      block('outline', outline),
      block('concepts', concepts),
      `Write a ${count}-question quiz across the whole scope: about 30% recall, 50% application, 20% harder transfer questions. Mix choice, multi, blank, number and short items, each with explanation, difficulty and conceptIds (use the ids given).

Return {"items":[…same item shape as practice items…]}`,
    ),
  }
}

export function summaryPrompt({ scopeTitle, passages, outline, language }) {
  return {
    system: join(PERSONA, `You write study notes that are clear, structured and faithful to the source. ${languageRule(language)}`),
    user: join(
      block('scope', scopeTitle),
      block('outline', outline),
      block('source_passages', passages),
      'Write structured study notes in Markdown: a 3–5 sentence overview, then sections with headings, key points, formulas ($…$ / $$…$$), and short examples, then a "Check yourself" list of 5 questions. Cite pages as (p. N) where the source says so.',
    ),
  }
}

export function digestPrompt({ title, passages, language }) {
  return {
    system: join(PERSONA, `You help learners digest long readings: you surface the structure and the argument, not just a summary. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('document', title),
      block('passages', passages),
      'Return {"overview":"3–5 sentences","structure":[{"heading":"…","points":["…"],"pages":"e.g. 3–7"}],"keyIdeas":["…"],"arguments":[{"claim":"…","support":"…","page":"…"}],"glossary":[{"term":"…","meaning":"…"}],"questions":["5 questions worth discussing or testing"]}',
    ),
  }
}

// ── instant help and shorts ─────────────────────────────────────────────────

const ASSIST_MODES = Object.freeze({
  explain: 'Explain the concept the learner asked about, at their level, intuition first, then precise, with one worked example. 5–9 steps, 1–2 checks.',
  solve: 'Solve the problem WITH the learner: restate it, identify the method, then work it step by step on the board, explaining why each move is made. Show the final answer clearly in a key note and add one similar practice check at the end. 4–10 steps.',
  visualize: 'Make the idea visible: lead with charts, diagrams or an animation built from correct numbers, and narrate what to notice in each picture. 3–7 steps.',
})

export function assistPrompt({ mode, request, language, passages, history, learner }) {
  return {
    system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
    user: join(
      learnerBlock(learner),
      block('earlier_in_this_session', history),
      block('source_passages', passages),
      block('request', request),
      ASSIST_MODES[mode] ?? ASSIST_MODES.explain,
      'Start with a step whose ops begin with a {"t":"title"} op naming the topic.',
    ),
  }
}

export function shortPrompt({ topic, passages, language }) {
  return {
    system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
    user: join(
      block('topic', topic),
      block('source', passages),
      `Make a two-minute explainer short for this topic, the kind someone shares because it made an idea finally click: a gripping first sentence, one core idea, a memorable visual (diagram, chart or animation), one concrete example, and a one-line takeaway. 6–9 steps; total narration about 260–320 words (or 450–550 Chinese characters). No checks. Use at most two board pages.`,
    ),
  }
}

export function materialBriefPrompt({ title, passages, language }) {
  return {
    system: join(PERSONA, languageRule(language), JSON_ONLY),
    user: join(
      block('document', title),
      block('passages', passages),
      'Describe this material for a course designer. Return {"summary":"3–4 sentences","topics":["main topics in order"],"level":"beginner|intermediate|advanced","suggestedGoal":"one sentence learning goal a student might have for it"}',
    ),
  }
}

export function profilePrompt({ profile, events, language }) {
  return {
    system: join(PERSONA, `You keep a short, respectful profile of the learner so future lessons fit them better. Only record what the evidence supports. ${languageRule(language)}`, JSON_ONLY),
    user: join(
      block('current_profile', profile),
      block('recent_learning_events', events),
      'Update the profile. Keep it short; merge rather than append duplicates; drop weaknesses the learner has clearly overcome. Return {"background":"…","goals":["…"],"strengths":["…"],"weaknesses":["…"],"preferences":{"style":"…"},"newNote":"<one sentence worth remembering, or empty>"}',
    ),
  }
}
