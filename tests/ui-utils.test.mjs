import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DOMParser } from 'linkedom'

import { createApi } from '../src/ui/api.js'
import { chartSvg, escapeXml, niceTicks } from '../src/ui/charts.js'
import { courseNextStep, lessonStage, nextStepFor, sessionStats } from '../src/ui/practice.js'
import { PREP_DELAY_MS, prepStages } from '../src/ui/prep.js'
import { STYLE } from '../src/ui/styles.js'
import { animationDocument, sanitizeSvg } from '../src/ui/sanitize.js'
import { splitSentences } from '../src/ui/speech.js'
import { syncedStarts, themedSvg, wrap } from '../src/ui/video.js'
import { captionSentences, inlinePlain, parseInline, sliceInline, spokenText, texToText } from '../src/ui/board/inline.js'

test('a practice round is summed up in stars, accuracy and streaks, with one next step', () => {
  const round = sessionStats([{ score: 1, correct: true }, { score: 1, correct: true }, { score: 0.5, correct: false }, { score: 1, correct: true }])
  assert.deepEqual(round, { answered: 4, correct: 3, accuracy: 0.875, stars: 2, streak: 1, bestStreak: 2 })
  assert.equal(sessionStats([{ score: 1, correct: true }]).stars, 3)
  assert.equal(sessionStats([]).stars, 1, 'finishing earns a star')
  assert.deepEqual(nextStepFor({ action: 'remediate' }, { lessonId: 'les_a' }), { kind: 'relearn', lessonId: 'les_a' })
  assert.deepEqual(nextStepFor({ action: 'review' }), { kind: 'review' })
  assert.deepEqual(nextStepFor({ action: 'challenge' }, { unitId: 'unt_a', nextLessonId: 'les_b' }), { kind: 'quiz', unitId: 'unt_a' })
  assert.deepEqual(nextStepFor({ action: 'challenge' }, { nextLessonId: 'les_b' }), { kind: 'next', lessonId: 'les_b' })
  assert.deepEqual(nextStepFor(null, {}), { kind: 'course' })
})

test('a course page suggests due reviews, then the weakest concept, then the next lesson', () => {
  const concept = (id, name) => ({ id, name })
  const course = { units: [{ id: 'unt_a', lectures: [{ lessons: [
    { id: 'les_a', title: '配方', concepts: [concept('cpt_a', '补全平方'), concept('cpt_b', '开方')] },
    { id: 'les_b', title: '公式法', concepts: [concept('cpt_c', '判别式')] },
  ] }] }] }
  const seen = (pKnown, attempts = 2) => ({ pKnown, attempts, history: [{}] })
  const now = Date.parse('2026-10-20T00:00:00Z')
  assert.deepEqual(courseNextStep(course, { lessons: {}, concepts: {} }, { now }), { kind: 'lesson', lessonId: 'les_a', title: '配方' })
  const weak = { lessons: { les_a: { status: 'done' } }, concepts: { cpt_a: seen(0.3), cpt_b: seen(0.2) } }
  assert.deepEqual(courseNextStep(course, weak, { now }), { kind: 'practice', lessonId: 'les_a', concept: '开方' })
  const due = { ...weak, reviews: { cpt_a: { dueAt: '2026-10-19T00:00:00Z' }, cpt_z: { dueAt: '2026-10-19T00:00:00Z' } } }
  assert.deepEqual(courseNextStep(course, due, { now }), { kind: 'review', count: 1 }, 'only this course\'s concepts count')
  const finished = { lessons: { les_a: { status: 'done' }, les_b: { status: 'done' } }, concepts: {} }
  assert.deepEqual(courseNextStep(course, finished, { now }), { kind: 'done', unitId: 'unt_a' })

  assert.deepEqual(lessonStage(course.units[0].lectures[0].lessons[0], { concepts: {} }), { stage: 'none', percent: 0 }, 'an untouched lesson lights nothing')
  assert.deepEqual(lessonStage(course.units[0].lectures[0].lessons[0], { concepts: { cpt_a: seen(0.9) } }), { stage: 'learning', percent: 55 })
})

test('each top-level class rule is defined once, so a new component cannot restyle an old one', () => {
  const counts = new Map()
  for (const line of STYLE.split('\n')) {
    const match = /^(\.[a-zA-Z][\w-]*)\{/u.exec(line.trim())
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  assert.ok(counts.size > 100)
  assert.deepEqual([...counts].filter(([, count]) => count > 1), [])
})

test('svg sanitizer keeps drawing markup and strips anything active or external', () => {
  const dirty = `<svg viewBox="0 0 100 100" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><div>html</div></foreignObject>
    <circle cx="50" cy="50" r="20" fill="#2f6fde" onclick="steal()" style="stroke:red;background:url(http://x)"/>
    <a href="https://evil.example"><text x="1" y="2">link</text></a>
    <use href="https://evil.example/sprite.svg#a"/>
    <use href="#local"/>
    <rect width="10" height="10" fill="url(https://evil.example/x)"/>
    <path d="M0 0 L10 10" marker-end="url(#arrow)"/>
  </svg>`
  const clean = sanitizeSvg(dirty, { DOMParserImpl: DOMParser })
  assert.ok(clean)
  assert.doesNotMatch(clean, /script|foreignObject|onload|onclick|evil\.example|background/u)
  assert.match(clean, /<circle/u)
  assert.match(clean, /stroke:red/u)
  assert.match(clean, /href="#local"/u)
  assert.match(clean, /marker-end="url\(#arrow\)"/u)
  assert.equal(sanitizeSvg('<div>no</div>', { DOMParserImpl: DOMParser }), null)
  assert.equal(sanitizeSvg(42, { DOMParserImpl: DOMParser }), null)
})

test('animation documents get a no-network CSP in their head', () => {
  assert.match(animationDocument('<canvas></canvas><script>1</script>'), /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/u)
  const withHead = animationDocument('<!doctype html><html><head><title>x</title></head><body></body></html>')
  assert.ok(withHead.indexOf('Content-Security-Policy') < withHead.indexOf('<title>'))
})

test('charts are drawn from data with nice ticks and escaped labels', () => {
  assert.deepEqual(niceTicks(0, 9.3, 5), [0, 2, 4, 6, 8, 10])
  const flat = niceTicks(5, 5)
  assert.ok(flat.includes(5) && flat[0] < 5 && flat[flat.length - 1] > 5)
  const line = chartSvg({ kind: 'line', title: 'a<b', xLabel: 't', yLabel: 'x', series: [{ name: 's1', points: [[0, 0], [1, 1], [2, 4]] }, { name: 's2', points: [[0, 1], [2, 1]] }], data: [] })
  assert.match(line, /^<svg /u)
  assert.match(line, /a&lt;b/u)
  assert.equal((line.match(/<path /gu) ?? []).length, 2)
  const bar = chartSvg({ kind: 'bar', data: [{ label: 'A', value: 3 }, { label: 'B', value: -1 }], series: [] })
  assert.equal((bar.match(/<rect /gu) ?? []).length, 2)
  const pie = chartSvg({ kind: 'pie', data: [{ label: 'x', value: 1 }, { label: 'y', value: 3 }], series: [] })
  assert.match(pie, /75%/u)
  assert.equal(escapeXml(`"'&`), '&quot;&#39;&amp;')
})

test('narration is split into short sentences for every speech engine', () => {
  assert.deepEqual(splitSentences('第一句。第二句！Third one? last'), ['第一句。', '第二句！', 'Third one?', 'last'])
  const long = splitSentences('长'.repeat(400))
  assert.ok(long.length >= 3 && long.every(part => part.length <= 160))
})

test('video captions never start a line with closing punctuation', () => {
  // A fake canvas where every character is 10 px wide.
  const ctx = { measureText: value => ({ width: [...value].length * 10 }) }
  const lines = wrap(ctx, '弹簧越硬，振得越快；物体越重，振得越慢。', 50)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.doesNotMatch(line, /^[，。；]/u, lines.join(' | '))
  assert.equal(lines.join(''), '弹簧越硬，振得越快；物体越重，振得越慢。')
  // An opening bracket moves down with what it opens.
  const bracketed = wrap(ctx, '这是一个（括号）例子', 50)
  for (const line of bracketed) assert.doesNotMatch(line, /（$/u, bracketed.join(' | '))
  assert.equal(bracketed.join(''), '这是一个（括号）例子')
  assert.deepEqual(wrap(ctx, 'two words', 1000), ['two words'])
})

test('SVGs drawn into a video carry the board ink, recolored for the dark theme', () => {
  const palette = { ink: '#ecebe4' }
  const svg = chartSvg({ kind: 'line', title: 'T', xLabel: 't', yLabel: 'x', series: [{ name: 'a', points: [[0, 0], [1, 1]] }], data: [] })
  const dark = themedSvg(svg, palette, 'dark')
  assert.match(dark, /^<svg[^>]*><style>svg\{color:#ecebe4\}/u)
  assert.match(dark, /\[stroke="#2b2b2b"\],\[stroke="#23262f"\]\{stroke:#ecebe4\}/u)
  assert.doesNotMatch(themedSvg(svg, palette, 'light'), /stroke:#ecebe4/u)
  assert.ok(new DOMParser().parseFromString(dark, 'image/svg+xml').querySelector('style'))
  assert.equal(themedSvg('<svg/>', palette, 'dark'), '<svg/>')
  assert.equal(themedSvg(null, palette, 'dark'), null)
})

test('formulas inside a highlight or bold keep rendering as math', () => {
  // Seen on a generated board: the highlight swallowed the formula as text.
  assert.deepEqual(parseInline('就想象一块==以 $a$ 为边的正方形==。'), [
    { kind: 'text', text: '就想象一块' },
    { kind: 'mark', text: '以 ' },
    { kind: 'math', tex: 'a', style: 'mark' },
    { kind: 'mark', text: ' 为边的正方形' },
    { kind: 'text', text: '。' },
  ])
  assert.deepEqual(parseInline('**$c^2$ 最大**'), [{ kind: 'math', tex: 'c^2', style: 'bold' }, { kind: 'bold', text: ' 最大' }])
  // "==" or "**" inside a formula never opens a style.
  assert.deepEqual(parseInline('$a == b$ 且 ==c=='), [{ kind: 'math', tex: 'a == b' }, { kind: 'text', text: ' 且 ' }, { kind: 'mark', text: 'c' }])
  assert.deepEqual(parseInline('==价格 $5=='), [{ kind: 'mark', text: '价格 $5' }])
  // A single "=" inside a highlight is text (seen on a generated board).
  assert.deepEqual(parseInline('只有 ==乘积 = 0== 时'), [{ kind: 'text', text: '只有 ' }, { kind: 'mark', text: '乘积 = 0' }, { kind: 'text', text: ' 时' }])
  assert.equal(inlinePlain('==以 $a$ 为边=='), '以 a 为边')
  assert.deepEqual(sliceInline(parseInline('==以 $a$ 为边=='), 2), [{ kind: 'mark', text: '以 ' }])
})

test('the preparation card waits a moment and shows the thinking stage only when the model thought', () => {
  // A model that writes at once starts a lesson within a second or two, before the card would show.
  assert.equal(PREP_DELAY_MS, 3000)
  assert.equal(prepStages({ phase: 'starting', thinking: 0 }), null)
  assert.equal(prepStages({ phase: 'writing', thinking: 0, steps: 1 }), null, 'nothing is ticked that never happened')
  assert.equal(prepStages(null), null)
  const states = prep => prepStages(prep).map(stage => `${stage.key}:${stage.state}`)
  assert.deepEqual(states({ phase: 'thinking', thinking: 1200 }), ['prepThinking:now', 'prepWriting:next'])
  assert.deepEqual(states({ phase: 'writing', thinking: 27_000, steps: 0 }), ['prepThinking:done', 'prepWriting:now'])
})

test('leaving a screen stops watching a job without cancelling it', async () => {
  const calls = []
  const rpc = {
    call: async (channel, endpoint, payload) => {
      calls.push(endpoint)
      if (endpoint === 'job/get') return { ok: true, value: { id: payload.id, status: 'running', partial: [], progress: { done: 1, total: 2 } } }
      return { ok: true, value: { id: payload.id, status: 'cancelled' } }
    },
  }
  const api = createApi(rpc)
  const controller = new AbortController()
  const watching = api.follow({ job: { id: 'job_a', status: 'running', partial: [] } }, { signal: controller.signal })
  controller.abort()
  await assert.rejects(watching, error => error.code === 'cancelled')
  assert.ok(!calls.includes('job/cancel'))
  await api.cancel({ id: 'job_a' })
  assert.deepEqual(calls.filter(endpoint => endpoint === 'job/cancel'), ['job/cancel'])
})

test('captions split narration into sentences without breaking formulas', () => {
  assert.deepEqual(captionSentences('由 $a^2+b^2=c^2;$ 可得。他说：“成立！”然后呢？好\n下一行'), ['由 $a^2+b^2=c^2;$ 可得。', '他说：“成立！”', '然后呢？', '好', '下一行'])
  assert.deepEqual(captionSentences('Pi is about 3.14. Then e.g. this works. Done'), ['Pi is about 3.14.', 'Then e.g. this works.', 'Done'])
  assert.deepEqual(captionSentences(''), [])
  assert.equal(spokenText('面积是 $\\frac{1}{2}ab$，**要点**'), '面积是 1/2ab，要点')
  assert.equal(texToText('\\sqrt{x^2+y^2}'), '√(x²+y²)')
})

test('a formula read aloud or drawn as text says what it shows, never a command name', () => {
  const read = {
    // Formulas the model wrote that came out as "mid", "frac6.63…", "tfrac52", "DeltapH".
    'P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}': 'P(A| B)=(P(A∩ B))/(P(B))',
    'E=\\frac{hc}{\\lambda}=\\frac{6.63\\times10^{-34}\\times3.00\\times10^{8}}{6.80\\times10^{-7}}': 'E=(hc)/λ=(6.63×10⁻³⁴×3.00×10⁸)/(6.80×10⁻⁷)',
    'x=-\\tfrac52\\ \\text{或}\\ x=\\tfrac52': 'x=-5/2 或 x=5/2',
    '\\Delta p = 2.3\\frac{RT}{F}\\Delta\\mathrm{pH}': 'Δ p = 2.3(RT)/FΔpH',
    'ab=0\\iff a=0': 'ab=0⇔ a=0',
    'N_A=6.02\\times10^{23}\\ \\mathrm{mol^{-1}}': 'NA=6.02×10²³ mol⁻¹',
    'P(\\text{患病}\\mid\\text{阳性})=\\frac{99}{1098}\\approx 9\\%': 'P(患病|阳性)=99/1098≈ 9%',
    '\\{2, 4, 6\\}': '{2, 4, 6}',
    // A condition over an arrow or an equals sign follows it in brackets.
    '6CO_2 + 6H_2O \\xrightarrow{\\text{光、叶绿体}} C_6H_{12}O_6 + 6O_2': '6CO₂ + 6H₂O →(光、叶绿体) C₆H₁₂O₆ + 6O₂',
    '2C_3 \\xrightarrow[\\text{ATP、NADPH}]{酶} (CH_2O) + C_5 \\tag{2}': '2C₃ →(酶, ATP、NADPH) (CH₂O) + C₅ (2)',
    '2H_2 + O_2 \\overset{\\text{点燃}}{=} 2H_2O': '2H₂ + O₂ =(点燃) 2H₂O',
    '2H_2O \\xrightarrow{通电} 2H_2\\uparrow + O_2\\uparrow': '2H₂O →(通电) 2H₂↑ + O₂↑',
    'N_2 + 3H_2 \\rightleftharpoons 2NH_3': 'N₂ + 3H₂ ⇌ 2NH₃',
    // Marks stay on their letters; rows go apart by semicolons, cells by commas.
    'P(+\\mid \\bar D)': 'P(+| D̄)',
    '\\vec{v} + \\bar{x} + \\hat{y}': 'v⃗ + x̄ + ŷ',
    'f(x) = \\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}': 'f(x) = x, x ≥ 0; -x, x < 0',
    '\\begin{aligned} f(x) &= (x+1)^2 \\\\ &= x^2 + 2x + 1 \\end{aligned}': 'f(x) = (x+1)²; = x² + 2x + 1',
    'A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}': 'A = (1, 2; 3, 4)',
    // Function names read as words; an unknown command is left out.
    '\\lim_{x\\to 0}\\frac{\\sin x}{x}=1': 'limₓ→₀(sin x)/x=1',
    '\\sin\\theta + \\log_2 8': 'sin θ + log₂ 8',
    'x \\in \\mathbb{R},\\ \\sqrt[3]{8}=2,\\ a \\not= b': 'x ∈ ℝ, ³√8=2, a ≠ b',
    '\\left.\\frac{dy}{dx}\\right|_{x=0}': '(dy)/(dx)|ₓ₌₀',
    '\\unknown{x} + \\constructor': 'x +',
  }
  for (const [tex, text] of Object.entries(read)) assert.equal(texToText(tex), text, tex)
  assert.equal(spokenText('光合作用：$6CO_2 + 6H_2O \\xrightarrow{光} C_6H_{12}O_6 + 6O_2$。'), '光合作用：6CO₂ + 6H₂O →(光) C₆H₁₂O₆ + 6O₂。')
})

test('exported videos write synced ops when their sentence starts', () => {
  const step = { say: '一二三四。五六七八。', ops: [{ t: 'p', text: 'a', at: 0 }, { t: 'p', text: 'b', at: 1 }] }
  assert.deepEqual(syncedStarts(step, [500, 500], 8000), [0, 4000])
  assert.deepEqual(syncedStarts(step, [6000, 500], 8000), [0, 6000], 'an op never starts before the one before it is done')
  assert.equal(syncedStarts({ say: '一。', ops: [{ t: 'p', text: 'a' }] }, [500], 1000), null)
})
