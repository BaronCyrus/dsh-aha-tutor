import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { DOMParser } from 'linkedom'
import { createElement as h } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'tsdown'

import { boardToMarkdown, boardToPlainText, normalizeBoard, readOp } from '../src/core/board-script.js'
import { formula, exprToText, parseExpr } from '../src/core/expr.js'
import { applyRepairs, MAX_REPAIRS, repairBudget, repairItems, settled } from '../src/core/figure-fix.js'
import { compilePlot, normalizePlot, plotCurveLabels, sampleCurves } from '../src/core/plot.js'
import { repairSvg, svgProblems } from '../src/core/svg-check.js'
import { generateSteps } from '../src/host/generate.js'
import { BOARD_SPEC, figureRepairPrompt } from '../src/host/prompts.js'
import { estimateHeight } from '../src/ui/board/layout.js'
import { en, format, zh } from '../src/ui/i18n.js'
import { animationDocument, reportedAnimationError, reportedAnimationHeight, sanitizeSvg } from '../src/ui/sanitize.js'
import { fitSvgElement, fittedViewBox } from '../src/ui/svg-fit.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const root = fileURLToPath(new URL('..', import.meta.url))
const value = (source, names, values) => formula(source, names).evaluate(values)

// ── why a picture cannot be drawn ──────────────────────────────────────────

test('a picture the board cannot draw says why', () => {
  const plot = readOp({ t: 'plot', fns: [{ y: 'sen(x)' }], caption: '正弦' }, 0)
  assert.equal(plot.op, null)
  assert.equal(plot.figure, 'plot')
  assert.match(plot.problems[0], /^curve 1: "y": Unknown name "sen" in "sen\(x\)"$/u)

  const svg = readOp({ t: 'svg', svg: '<svg viewBox="0 0 10 10"><g><text>A</g></svg>' }, 0)
  assert.equal(svg.op, null)
  assert.equal(svg.figure, 'svg')
  assert.deepEqual(svg.problems, ['</g> closes <text>', '</svg> closes <g>', '<svg> is never closed'])
  assert.deepEqual(readOp({ t: 'svg', svg: '<div>no</div>' }, 0).problems, ['the markup does not start with <svg'])

  assert.deepEqual(readOp({ t: 'anim', html: '  ' }, 0), { op: null, figure: 'anim', problems: ['the animation has no "html"'] })
  assert.deepEqual(readOp({ t: 'chart', kind: 'bar' }, 0).problems, ['the chart has no data points ("series" or "data")'])
  assert.deepEqual(readOp({ t: 'plot', series: [] }, 0).problems, ['the plot has no curves ("fns")'])

  // A plot that lost one curve is drawn with the others, and says what it lost.
  const partial = readOp({ t: 'plot', fns: [{ y: 'x^2' }, { y: 'f(x)+1' }] }, 0)
  assert.equal(partial.op.fns.length, 1)
  assert.match(partial.problems[0], /^curve 2: "y": Unknown name "f"/u)
  // A curve past the four drawn is no problem: it would not be drawn anyway.
  const crowded = readOp({ t: 'plot', fns: ['x', '2x', '3x', '4x', 'nope(x)'] }, 0)
  assert.equal(crowded.op.fns.length, 4)
  assert.deepEqual(crowded.problems, [])

  // Text and layout ops are not pictures: nothing to say about them.
  assert.deepEqual(readOp({ t: 'p', text: '' }, 0), { op: null, figure: null, problems: [] })
  assert.deepEqual(readOp({ t: 'h', text: '标题' }, 0).problems, [])
})

test('a picture that cannot be drawn keeps its place, and the board lists what is wrong', () => {
  const problems = []
  const board = normalizeBoard([
    { say: '先看图像。', ops: [{ t: 'h', text: '分段函数' }, { t: 'plot', id: 'fig', fns: [{ y: 'g(x)' }], caption: '图像', at: 0 }] },
    { say: '圈出它。', ops: [{ t: 'mark', ref: 'fig', style: 'circle' }, { t: 'svg', svg: '<svg><rect></svg>', caption: '示意图' }] },
  ], { problems })
  const [heading, missing] = board.steps[0].ops
  assert.equal(heading.id, 'o1')
  assert.deepEqual(missing, { id: 'o2', t: 'missing', of: 'plot', caption: '图像', formula: 'y = g(x)', at: 0 })
  assert.equal(board.steps[1].ops[0].ref, 'o2', 'a mark still points at it')
  assert.deepEqual(board.steps[1].ops[1], { id: 'o4', t: 'missing', of: 'svg', caption: '示意图', formula: '' })
  assert.deepEqual(problems.map(({ op, kind, say }) => [op, kind, say]), [['o2', 'plot', '先看图像。'], ['o4', 'svg', '圈出它。']])
  assert.equal(problems[0].raw.id, 'fig', 'the op as the model wrote it')

  // It takes the room the picture would have, says so to prompts and in notes.
  assert.equal(estimateHeight(missing), 9)
  assert.equal(estimateHeight(board.steps[1].ops[1]), 8.5)
  assert.match(boardToPlainText(board), /\(a plot that could not be drawn: 图像 — y = g\(x\)\)/u)
  assert.match(boardToMarkdown(board, { missing: zh.figureMissing }), /> ⚠ 这张图没画出来 · 图像 · `y = g\(x\)`/u)
  // Saved, it reads back the same; nothing written can make it redraw.
  assert.deepEqual(readOp({ ...missing, redraw: true }, 0).op, { id: 'o2', t: 'missing', of: 'plot', caption: '图像', formula: 'y = g(x)' })
})

// ── free fixes ─────────────────────────────────────────────────────────────

test('letters a plot uses without declaring them become sliders', () => {
  const plot = normalizePlot({ fns: [{ y: 'a*x^2 + b' }, { y: 'A*sin(omega*x)' }, { y: 'v0*x' }] })
  assert.deepEqual(plot.params.map(({ name, value: start, min, max }) => [name, start, min, max]), [['a', 1, 0, 2], ['b', 1, 0, 2], ['A', 1, 0, 2], ['ω', 1, 0, 2], ['v0', 1, 0, 2]])
  assert.equal(plot.fns.length, 3)

  // Declared sliders keep their own ranges; values given as constants keep their value.
  const declared = normalizePlot({ fns: [{ y: 'k*x - g' }], params: [{ name: 'k', value: 2, min: 0, max: 5 }], constants: { g: 9.8 } })
  assert.deepEqual(declared.params.map(({ name, value: start, min, max }) => [name, start, min, max]), [['k', 2, 0, 5], ['g', 9.8, 0, 19.6]])

  // Not a slider: a function the parser does not know, a word, the imaginary
  // unit, y, or the variable of a parametric curve.
  for (const source of ['f(x) + 1', 'speed*x', 'e^(i*x)', 'y + x']) {
    const problems = []
    assert.equal(normalizePlot({ fns: [{ y: source }] }, { problems }), null, source)
    assert.match(problems[0], /Unknown name/u, source)
  }
  assert.deepEqual(normalizePlot({ fns: [{ x: 'R*cos(t)', y: 'R*sin(t)' }] }).params.map(param => param.name), ['R'])

  // At most PLOT_LIMITS.params sliders, whatever the formula asks for.
  const problems = []
  assert.equal(normalizePlot({ fns: [{ y: 'a+b+c+d+f+g+h' }] }, { problems }), null)
  assert.match(problems[0], /Unknown name "h"/u)
})

test('a function in pieces is one formula, and its graph breaks only where it jumps', () => {
  const abs = ['if(x < 0, -x, x)', 'x < 0 ? -x : x', 'piecewise(x < 0, -x, x)']
  for (const source of abs) for (const x of [-3, 0, 2]) assert.equal(value(source, ['x'], [x]), Math.abs(x), `${source} at ${x}`)
  assert.equal(value('piecewise(x < 0, 0, x < 1, x, 1)', ['x'], [0.25]), 0.25)
  assert.equal(value('piecewise(x < 0, 0, x < 1, x, 1)', ['x'], [7]), 1)
  assert.ok(Number.isNaN(value('piecewise(x < 0, 0)', ['x'], [1])), 'no piece: no value')
  assert.equal(value('0 <= x < 2', ['x'], [1]), 1, 'a chained comparison holds when both do')
  assert.equal(value('0 <= x < 2', ['x'], [2]), 0)
  assert.equal(value('x > 0 and x < 1', ['x'], [0.5]), 1)
  assert.equal(value('x < 0 or x > 1', ['x'], [0.5]), 0)
  assert.equal(value('x < 0 || x > 1', ['x'], [2]), 1)
  assert.equal(value('(x < 0)*(-x) + (x >= 0)*x', ['x'], [-2]), 2)
  assert.equal(value('x ≤ 1 && x \\geq 0', ['x'], [1]), 1, 'Unicode and LaTeX comparisons')
  assert.equal(value('||x||', ['x'], [-2]), 2, 'bars are still absolute values')
  assert.throws(() => parseExpr('x and', ['x']), /Unexpected end/u)
  assert.throws(() => parseExpr('if(x, 1)', ['x']), /takes 3 arguments/u)

  const read = source => exprToText(parseExpr(source, ['x']))
  assert.equal(read('if(x < 0, -x, x)'), '−x (x < 0); x (x ≥ 0)')
  assert.equal(read('x < 0 ? 0 : x < 1 ? x : 1'), '0 (x < 0); x (x < 1); 1')
  assert.equal(read('2*if(x > 0, 1, 0)'), '2·{1 (x > 0); 0 (x ≤ 0)}')
  assert.equal(read('0 <= x < 2'), '0 ≤ x < 2')

  const curve = (source, x = [-2, 2]) => {
    const plot = normalizePlot({ fns: [{ y: source }], x })
    return sampleCurves(plot, compilePlot(plot), [])[0]
  }
  const runs = points => points.reduce((count, point, index) => count + (point.every(Number.isFinite) && !points[index - 1]?.every(Number.isFinite) ? 1 : 0), 0)
  // A step is two pieces with a gap between, the first ending where the jump is.
  const step = curve('if(x < 0, -1, 1)')
  const gap = step.findIndex(point => !point.every(Number.isFinite))
  assert.equal(runs(step), 2)
  assert.ok(Math.abs(step[gap - 1][0]) < 1e-6 && step[gap - 1][1] === -1 && step[gap + 1][1] === 1)
  // A continuous joint (|x|) breaks too, but its pieces meet.
  const kink = curve('if(x < 0, -x, x)')
  const joint = kink.findIndex(point => !point.every(Number.isFinite))
  assert.ok(Math.abs(kink[joint - 1][1] - kink[joint + 1][1]) < 1e-6)
  assert.equal(runs(curve('floor(x)', [-1.5, 1.5])), 4, 'a staircase has no risers')
  assert.equal(runs(curve('x^2')), 1, 'a smooth curve is one run')
  assert.deepEqual(plotCurveLabels(normalizePlot({ fns: [{ y: 'if(x < 0, -x, x)' }] })), ['y = −x (x < 0); x (x ≥ 0)'])
})

test('model SVG is made well-formed for free where that is safe, and what is left is named', () => {
  const fixed = repairSvg('<?xml version="1.0"?><svg viewbox="0 0 120 40"><lineargradient id="g"/><text x="4" y="20">A & B&nbsp;=&deg; x < 3</text><use xlink:href="#g" inkscape:label="l"/><rect width=10 hidden/></svg>junk')
  assert.equal(fixed, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" xmlns:xlink="http://www.w3.org/1999/xlink"><linearGradient id="g"/><text x="4" y="20">A &amp; B&#160;=&#176; x &lt; 3</text><use xlink:href="#g"/><rect width="10"/></svg>')
  assert.deepEqual(svgProblems(fixed), [])
  assert.equal(repairSvg(fixed), fixed, 'fixing again changes nothing')
  // JSON escaped twice, scripts and foreign HTML (which the board drops anyway).
  assert.equal(repairSvg('<svg viewBox=\\"0 0 1 1\\"><script>if (a < b) go()</script><foreignObject><p>x<br></p></foreignObject><circle r=\\"1\\"/></svg>'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="1"/></svg>')

  assert.deepEqual(svgProblems(repairSvg('<svg><g><rect></g></svg>')), ['</g> closes <rect>', '</svg> closes <g>', '<svg> is never closed'])
  assert.deepEqual(svgProblems('<svg xmlns="http://www.w3.org/2000/svg"><a:b/></svg>'), ['the prefix "a:" of <a:b> is not declared'])
  assert.deepEqual(svgProblems('<svg><rect width="1" width="2"/></svg>'), ['attribute width appears twice in <rect>'])
  assert.deepEqual(svgProblems('<svg><text>&foo;</text></svg>'), ['&foo; is not an XML entity'])
  assert.deepEqual(svgProblems('<svg><style><![CDATA[a > b < c]]></style><!-- x < y --></svg>'), [], 'CDATA and comments may hold anything')

  // The browser fixes boards saved before the host did.
  const clean = sanitizeSvg('<svg viewbox="0 0 10 10"><text>A & B</text></svg>', { DOMParserImpl: DOMParser })
  assert.match(clean, /viewBox="0 0 10 10"/u)
  assert.match(clean, /A &amp; B/u)
})

test('a diagram\'s viewBox grows to hold what it draws', () => {
  assert.equal(fittedViewBox({ viewBox: '0 0 100 50', box: { x: 10, y: 5, width: 60, height: 30 } }), null, 'it fits')
  assert.equal(fittedViewBox({ viewBox: '0 0 100 50', box: { x: -12, y: 5, width: 130, height: 30 } }), '-18 0 142 50', 'a label past both sides')
  assert.equal(fittedViewBox({ viewBox: '0,0,100,50', box: { x: 0, y: 0, width: 100, height: 61 } }), '0 0 100 67')
  assert.equal(fittedViewBox({ width: '200', height: '100', box: { x: 0, y: -8, width: 50, height: 50 } }), '0 -14 200 114', 'no viewBox: its width and height')
  assert.equal(fittedViewBox({ viewBox: '', box: { x: 0, y: 0, width: 500, height: 500 } }), null, 'nothing to grow from')
  assert.equal(fittedViewBox({ viewBox: '0 0 100 50', box: { x: 0, y: 0, width: 0, height: 0 } }), null, 'nothing measured')

  // A live element: measured again (once fonts arrive), it starts from the viewBox it had.
  const attributes = new Map([['viewBox', '0 0 100 50']])
  let box = { x: 0, y: 0, width: 140, height: 50 }
  const svg = { getBBox: () => box, getAttribute: name => attributes.get(name) ?? null, setAttribute: (name, next) => attributes.set(name, next), hasAttribute: name => attributes.has(name) }
  assert.equal(fitSvgElement(svg), true)
  assert.equal(attributes.get('viewBox'), '0 0 146 50')
  box = { x: 0, y: 0, width: 120, height: 50 }
  assert.equal(fitSvgElement(svg), true)
  assert.equal(attributes.get('viewBox'), '0 0 126 50', 'not wider than it needs')
  box = { x: 0, y: 0, width: 90, height: 50 }
  fitSvgElement(svg)
  assert.equal(attributes.get('viewBox'), '0 0 100 50', 'back to the original once it fits')
  assert.equal(fitSvgElement({ getAttribute: () => null }), false, 'an element that cannot be measured is left alone')
})

test('an animation whose code fails says so, before its own scripts run', () => {
  const page = animationDocument('<canvas></canvas><script>boom()</script>')
  assert.ok(page.indexOf('ahaAnimError') < page.indexOf('boom()'), 'the reporter comes first')
  assert.match(page, /addEventListener\('error'/u)
  assert.match(page, /ResizeObserver loop/u, 'a ResizeObserver notice is not an error of the page')
  assert.equal(reportedAnimationError({ ahaAnimError: 1 }), true)
  assert.equal(reportedAnimationError({ ahaAnimHeight: 300 }), false)
  assert.equal(reportedAnimationHeight({ ahaAnimError: 1 }), 0)
})

// ── one repair call ────────────────────────────────────────────────────────

const BROKEN_PLOT = { t: 'plot', fns: [{ y: 'sen(x)' }], caption: '正弦曲线', at: 1 }
const BROKEN_SVG = { t: 'svg', svg: '<svg viewBox="0 0 10 10"><g></svg>', caption: '电路' }

// A model port that writes `lines` as a board and answers the repair call
// with `reply` (a string, or an error to throw).
function fakeModel(lines, reply) {
  const calls = []
  return {
    calls,
    async stream({ onText }) {
      const textValue = lines.map(line => `${JSON.stringify(line)}\n`).join('')
      onText(textValue)
      return textValue
    },
    async complete(options) {
      calls.push(options)
      if (reply instanceof Error) throw reply
      return typeof reply === 'function' ? reply(options) : reply
    },
  }
}

test('pictures still wrong after a board is written are redrawn in one call, by id', async () => {
  const lines = [
    { say: '先看正弦。再看电路。', ops: [{ t: 'h', text: '波形' }, BROKEN_PLOT, BROKEN_SVG] },
    { say: '小结。', ops: [{ t: 'p', text: '完' }] },
  ]
  const reply = JSON.stringify({ figures: [
    { id: 'o2', op: { t: 'plot', fns: [{ y: 'sin(x)' }], caption: '正弦曲线' } },
    { id: 'o3', op: { t: 'svg', svg: '<svg><g></svg>' } },
    { id: 'o1', op: { t: 'plot', fns: [{ y: 'x' }] } },
  ] })
  const model = fakeModel(lines, reply)
  const sent = []
  const reports = []
  const board = await generateSteps(model, { prompt: { system: 's', user: 'u' }, onStep: step => sent.push(step), onProgress: info => reports.push(info), progressEveryMs: 0 })

  // While the board was written, the broken pictures said they would be redrawn.
  assert.deepEqual(sent[0].ops.map(op => [op.id, op.t, op.redraw]), [['o1', 'h', undefined], ['o2', 'missing', true], ['o3', 'missing', true]])
  assert.deepEqual(reports.at(-1), { phase: 'repairing', thinking: 0, chars: reports.at(-1).chars, figures: 2, steps: 2, current: '' })

  // One call, on the teach model thinking as little as it can.
  assert.equal(model.calls.length, 1)
  const [call] = model.calls
  assert.equal(call.purpose, 'teach')
  assert.equal(call.effort, 'lowest')
  assert.equal(call.maxTokens, repairBudget([{ kind: 'plot' }, { kind: 'svg' }]))
  assert.match(call.user, /Unknown name \\"sen\\"/u, 'what is wrong with each')
  assert.match(call.user, /"say": "先看正弦。再看电路。"/u, 'what the teacher says')
  assert.match(call.system, /calculator syntax/u, 'how a plot is written')
  assert.match(call.system, /well-formed XML/u, 'what an svg must be')

  // The plot came back right and takes its place (and its sentence); the
  // svg is still broken and says so; o1 was never broken.
  const [heading, plot, svg] = board.steps[0].ops
  assert.deepEqual(heading, { id: 'o1', t: 'h', text: '波形', at: 0 })
  assert.equal(plot.t, 'plot')
  assert.equal(plot.id, 'o2')
  assert.equal(plot.at, 1)
  assert.deepEqual(plot.fns, [{ kind: 'fx', y: 'sin(x)', name: '' }])
  assert.deepEqual(svg, { id: 'o3', t: 'missing', of: 'svg', caption: '电路', formula: '', at: 1 })
})

test('a board with nothing broken costs no call, and a failed call leaves the board as written', async () => {
  const clean = fakeModel([{ say: '你好。', ops: [{ t: 'plot', fns: [{ y: 'a*x' }] }] }], '{}')
  const board = await generateSteps(clean, { prompt: { system: 's', user: 'u' } })
  assert.equal(clean.calls.length, 0, 'an undeclared letter is a slider, not a repair')
  assert.deepEqual(board.steps[0].ops[0].params.map(param => param.name), ['a'])

  const failing = fakeModel([{ say: '看图。', ops: [BROKEN_PLOT] }], Object.assign(new Error('quota'), { code: 'llm-quota' }))
  const kept = await generateSteps(failing, { prompt: { system: 's', user: 'u' } })
  assert.equal(failing.calls.length, 1)
  assert.deepEqual(kept.steps[0].ops[0], { id: 'o1', t: 'missing', of: 'plot', caption: '正弦曲线', formula: 'y = sen(x)', at: 1 })

  const garbled = fakeModel([{ say: '看图。', ops: [BROKEN_PLOT] }], 'not json at all')
  assert.equal((await generateSteps(garbled, { prompt: { system: 's', user: 'u' } })).steps[0].ops[0].t, 'missing')
  assert.equal(garbled.calls.length, 1, 'no second call to repair the repair')

  const off = fakeModel([{ say: '看图。', ops: [BROKEN_PLOT] }], '{}')
  const sent = []
  await generateSteps(off, { prompt: { system: 's', user: 'u' }, repair: false, onStep: step => sent.push(step) })
  assert.equal(off.calls.length, 0)
  assert.equal(sent[0].ops[0].redraw, undefined)

  // Cancelling while pictures are redrawn cancels the job.
  const controller = new AbortController()
  const cancelled = fakeModel([{ say: '看图。', ops: [BROKEN_PLOT] }], () => {
    controller.abort(new Error('cancelled'))
    throw new Error('aborted')
  })
  await assert.rejects(generateSteps(cancelled, { prompt: { system: 's', user: 'u' }, signal: controller.signal }), /cancelled/u)
})

test('repairs are checked like any op and only replace the pictures that were broken', () => {
  const problems = [{ op: 'o2', kind: 'plot', reasons: ['x'], say: '', raw: BROKEN_PLOT }, { op: 'o3', kind: 'svg', reasons: ['y'], say: '', raw: BROKEN_SVG }]
  const steps = [{ id: 's1', say: '', ops: [{ id: 'o1', t: 'p', text: 'a' }, { id: 'o2', t: 'missing', of: 'plot', at: 2 }, { id: 'o3', t: 'missing', of: 'svg' }] }]
  const good = { t: 'plot', fns: ['x^2'] }
  for (const reply of [{ figures: [{ id: 'o2', op: good }] }, [{ id: 'o2', op: good }], { o2: good }, { ops: [{ opId: 'o2', replace: good }] }]) {
    const { steps: next, fixed } = applyRepairs(steps, problems, reply)
    assert.deepEqual(fixed, ['o2'], JSON.stringify(reply))
    assert.deepEqual([next[0].ops[1].t, next[0].ops[1].id, next[0].ops[1].at], ['plot', 'o2', 2])
  }
  // Not a picture, still broken, or not asked for: left as they were.
  const { steps: same, fixed } = applyRepairs(steps, problems, { figures: [
    { id: 'o3', op: { t: 'p', text: '画不出来' } },
    { id: 'o2', op: { t: 'plot', fns: ['x^2', 'nope(x)'] } },
    { id: 'o1', op: good },
  ] })
  assert.deepEqual(fixed, [])
  assert.equal(same, steps)
  // A picture may come back as another kind when that shows it right.
  assert.equal(applyRepairs(steps, problems, { o3: { t: 'chart', kind: 'bar', data: [{ label: 'a', value: 1 }] } }).steps[0].ops[2].t, 'chart')

  // At most MAX_REPAIRS pictures, each cut to a size the model can read again.
  const many = Array.from({ length: MAX_REPAIRS + 2 }, (_, index) => ({ op: `o${index + 1}`, kind: 'svg', reasons: ['bad'], say: 'x', raw: { t: 'svg', svg: `<svg>${'x'.repeat(20_000)}`, at: 0, id: 'keep' } }))
  const items = repairItems(many)
  assert.equal(items.length, MAX_REPAIRS)
  assert.ok(items[0].op.svg.length < 12_100 && items[0].op.svg.endsWith('…(cut)'))
  assert.equal(items[0].op.at, undefined)
  assert.equal(repairBudget(items), 16_000)
  assert.deepEqual(settled([{ id: 's1', ops: [{ id: 'o1', t: 'missing', redraw: true }] }])[0].ops[0], { id: 'o1', t: 'missing' })
})

test('the board prompt shows functions in pieces, and the repair prompt shows only the kinds it fixes', () => {
  assert.match(BOARD_SPEC, /if\(x<0, -x, x\)/u)
  assert.match(BOARD_SPEC, /piecewise\(x<0, 0, x<1, x, 1\)/u)
  const prompt = figureRepairPrompt({ items: [{ id: 'o2', kind: 'plot', problems: ['bad'], say: '看', op: BROKEN_PLOT }] })
  assert.match(prompt.system, /"t":"plot"/u)
  assert.match(prompt.system, /"t":"chart"/u, 'a plot may come back as a chart')
  assert.doesNotMatch(prompt.system, /"t":"svg"|"t":"anim"/u)
  assert.match(prompt.system, /\{"figures":\[\{"id":/u)
  assert.match(prompt.user, /^<pictures>\n\[/u)
})

// ── on the board ───────────────────────────────────────────────────────────

let bundle
let outDir

before(async () => {
  const cache = join(root, 'node_modules', '.cache')
  await mkdir(cache, { recursive: true })
  outDir = await mkdtemp(join(cache, 'aha-board-'))
  await build({
    config: false,
    entry: { board: join(root, 'tests', 'fixtures', 'ui', 'board.js') },
    outDir,
    format: 'esm',
    platform: 'node',
    dts: false,
    logLevel: 'silent',
    alias: { '@deepseek-ai/dsh-client-ui-primitives': join(root, 'tests', 'fixtures', 'ui', 'primitives.js') },
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'katex'], alwaysBundle: ['@deepseek-ai/dsh-client-ui-primitives'] },
  })
  const file = (await readdir(outDir)).find(name => /^board\.m?js$/u.test(name))
  bundle = await import(pathToFileURL(join(outDir, file)).href)
})

after(() => rm(outDir, { recursive: true, force: true }))

function textOf(node) {
  if (typeof node === 'string') return node
  return (node?.children ?? []).map(textOf).join('')
}

test('the board says a picture is being redrawn, then that it could not be drawn; exports say so too', () => {
  const t = (key, values) => format(zh[key] ?? key, values)
  const steps = redraw => [{ id: 's1', say: '看图。', ops: [
    { id: 'o1', t: 'missing', of: 'plot', caption: '分段函数', formula: 'y = g(x)', ...(redraw ? { redraw: true } : {}) },
    { id: 'o2', t: 'missing', of: 'anim', caption: '单摆' },
  ] }]
  const live = redraw => h(bundle.AppContext.Provider, { value: { t, settings: {} } }, h(bundle.Board, { steps: steps(redraw), position: null, view: 'pages' }))
  let renderer
  act(() => { renderer = TestRenderer.create(live(true)) })
  const boxes = () => renderer.root.findAll(node => node.props?.className === 'aha-op-missing')
  assert.equal(boxes().length, 2)
  assert.equal(boxes()[0].props['data-redraw'], 'true')
  assert.match(textOf(boxes()[0]), /^正在重画这张图…分段函数y = g\(x\)$/u)
  assert.match(textOf(boxes()[1]), /^⚠动画没能播放单摆$/u)
  act(() => renderer.update(live(false)))
  assert.equal(boxes()[0].props['data-redraw'], undefined)
  assert.match(textOf(boxes()[0]), /^⚠这张图没画出来分段函数y = g\(x\)$/u)

  // Export sheets never show a picture as still being redrawn.
  let sheets
  act(() => { sheets = TestRenderer.create(h(bundle.BoardSheets, { steps: steps(true), figureLabels: { missing: en.figureMissing, redrawing: en.figureRedrawing, animation: en.animationFailed } })) })
  const exported = sheets.root.findAll(node => node.props?.className === 'aha-op-missing')
  assert.match(textOf(exported[0]), /^⚠This figure could not be drawn/u)

  // A diagram the browser cannot read shows the same box with its caption.
  let svg
  act(() => { svg = TestRenderer.create(h(bundle.BoardSheets, { steps: [{ id: 's1', say: '', ops: [{ id: 'o1', t: 'svg', svg: '<svg><g></svg>', caption: '电路' }] }] })) })
  assert.match(textOf(svg.root.findByProps({ className: 'aha-op-missing' })), /^⚠This figure could not be drawn电路$/u)
})
