import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { boardToMarkdown, boardToPlainText, normalizeBoard } from '../src/core/board-script.js'
import { normalizeItem } from '../src/core/course-model.js'
import { constantValue, exprToText, formula, parseExpr } from '../src/core/expr.js'
import { compilePlot, normalizePlot, plotBounds, plotToText, sampleCurves } from '../src/core/plot.js'
import { BOARD_SPEC } from '../src/host/prompts.js'
import { estimateHeight } from '../src/ui/board/layout.js'
import { plotSvg } from '../src/ui/plot.js'

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} ≈ ${expected}`)
const value = (source, names = [], values = []) => formula(source, names).evaluate(values)

test('formulas are read in calculator syntax, as a textbook writes them', () => {
  close(value('1 + 2*3^2'), 19)
  close(value('-x^2', ['x'], [3]), -9, 'a minus sign binds after the power')
  close(value('2^-1'), 0.5)
  close(value('2^3^2'), 512, 'powers group from the right')
  close(value('2x^2 − 3', ['x'], [2]), 5, 'implicit products and the Unicode minus')
  close(value('(x+1)(x-1)', ['x'], [3]), 8)
  close(value('kx', ['x', 'k'], [2, 5]), 10, 'a run of known names is a product')
  close(value('2πx', ['x'], [1]), 2 * Math.PI)
  close(value('√(1 − x²)', ['x'], [0.6]), 0.8)
  close(value('|x - 2|', ['x'], [0]), 2)
  close(value('A·sin(ω×t)', ['t', 'A', 'ω'], [1, 2, Math.PI / 2]), 2)
  close(value('e^(-x^2/2)/sqrt(2pi)', ['x'], [0]), 1 / Math.sqrt(2 * Math.PI))
  close(value('x^(1/3)', ['x'], [-8]), -2, 'odd roots of negative numbers are real')
  close(value('log(100) + ln(e) + log2(8)'), 6)
  close(value('max(x, 0, -1) + min(1, 2)', ['x'], [-5]), 1)
  assert.ok(Number.isNaN(value('sqrt(x)', ['x'], [-1])), 'outside its domain a formula is NaN, not an error')
  close(constantValue('-2*pi'), -2 * Math.PI)
  close(constantValue(' π/2 '), Math.PI / 2)
  assert.equal(constantValue('x'), null)
  assert.equal(constantValue('1/0'), null)
})

test('a formula is never run as code: unknown names and syntax are refused', () => {
  for (const source of ['alert(1)', 'constructor', '__proto__', 'Math.sin(x)', 'x!', 'sin x', 'foo(x)', 'x +', '2**', '', 'x'.repeat(300), '('.repeat(60) + 'x' + ')'.repeat(60), 'this', 'globalThis']) {
    assert.throws(() => parseExpr(source, ['x']), /./u, JSON.stringify(source.slice(0, 30)))
  }
  assert.throws(() => parseExpr('sin(x, 2)', ['x']), /argument/u)
  assert.throws(() => parseExpr('y', ['x']), /Unknown name "y"/u)
})

test('formulas read back as plain Unicode', () => {
  const show = (source, names = ['x']) => exprToText(parseExpr(source, names))
  assert.equal(show('A*sin(ω*x)', ['x', 'A', 'ω']), 'A·sin(ωx)')
  assert.equal(show('2x^2 - 3'), '2x² − 3')
  assert.equal(show('(x+1)(x-1)'), '(x + 1)(x − 1)')
  assert.equal(show('2*pi*x'), '2πx')
  assert.equal(show('sqrt(1 - x^2)'), '√(1 − x²)')
  assert.equal(show('e^(-x)'), 'e^(−x)')
  assert.equal(show('1/(x+1)'), '1 / (x + 1)')
})

test('a plot keeps curves of every kind, sliders and marks, and drops what it cannot draw', () => {
  const plot = normalizePlot({
    title: '振动',
    x: ['0', '2*pi'],
    fns: [{ y: 'y = A*sin(w*x)', name: 'x(t)' }, { x: 'cos(t)', y: 'sin(t)' }, { r: 'r(θ) = 1 + cos(θ)' }, { y: 'nonsense(x)' }, 'x^2'],
    params: [{ name: 'A', value: 9, min: 0, max: 2 }, { name: 'w', min: 1, max: 3 }, { name: 'x', min: 0, max: 1 }, { name: 'sin', min: 0, max: 1 }, { name: 'B', min: 2, max: 1 }],
    points: [{ x: 'pi/2', label: '最高点' }, { x: 1, y: 2 }, { x: 'oops' }, { x: 1, fn: 1 }],
    lines: [{ x: 'pi' }, { y: 1, label: 'y = 1' }, { label: 'nothing' }],
    shade: [{ fn: 0, from: 0, to: 'pi' }, { fn: 2, from: 0, to: 1 }, { fn: 0, from: 2, to: 1 }],
    tangents: [{ fn: 0, x: 0 }],
  })
  assert.deepEqual(plot.fns.map(fn => fn.kind), ['fx', 'param', 'polar', 'fx'])
  assert.equal(plot.fns[0].y, 'A*sin(w*x)', 'the left-hand side goes')
  assert.equal(plot.fns[2].r, '1 + cos(θ)')
  assert.deepEqual(plot.fns[1].t, [0, 2 * Math.PI], 'a parametric curve runs over a full turn by default')
  assert.deepEqual(plot.params.map(param => [param.name, param.value, param.min, param.max]), [['A', 2, 0, 2], ['w', 2, 1, 3]], 'reserved and function names, and empty ranges, are no sliders')
  assert.ok(plot.params.every(param => param.step > 0))
  close(plot.x.max, 2 * Math.PI)
  assert.equal(plot.xPi, true, 'a range written with π is marked in π')
  assert.deepEqual(plot.points.map(point => [point.fn, point.y]), [[0, undefined], [undefined, 2]], 'a point without y sits on an y = f(x) curve')
  assert.deepEqual(plot.lines, [{ x: Math.PI, label: '' }, { y: 1, label: 'y = 1' }])
  assert.deepEqual(plot.shades.map(shade => shade.fn), [0], 'areas need an y = f(x) curve and a range')
  assert.equal(plot.tangents.length, 1)
  // A course pack normalizes saved plots again: nothing changes.
  assert.deepEqual(normalizePlot(plot), plot)
  const polar = normalizePlot({ fns: [{ r: '2', t: [0, 'pi'] }], equal: true, x: [0, 8] })
  assert.deepEqual(normalizePlot(polar), polar)
  assert.equal(normalizePlot({ fns: [{ y: 'evil()' }] }), null)
  assert.equal(normalizePlot({ x: [0, 1] }), null)
  // A single curve may be the plot itself.
  assert.equal(normalizePlot({ y: 'x^3', x: [-2, 2] }).fns[0].y, 'x^3')
})

test('a plot keeps the sliders its formulas need, whatever they are called and however their ranges are written', () => {
  const sliders = raw => normalizePlot(raw)?.params.map(param => [param.name, param.value, param.min, param.max]) ?? null
  // Saving early or late at a rate r: r used to be refused, and the curves with it.
  assert.deepEqual(sliders({ fns: [{ y: 'P*(1+r)^x' }, { y: 'P*(1+r)^(x-10)', domain: [10, 40] }], x: [0, 40], params: [{ name: 'P', value: 1, min: 1, max: 5 }, { name: 'r', value: 0.05, min: 0.01, max: 0.1 }] }), [['P', 1, 1, 5], ['r', 0.05, 0.01, 0.1]])
  // A launch angle θ, a speed v, an eccentricity e (no longer read as Euler's number).
  assert.deepEqual(sliders({ fns: ['tan(θ)*x - 9.8*x^2/(2*v^2*cos(θ)^2)'], x: [0, 12], params: [{ name: 'θ', value: 0.8, min: 0.2, max: 1.4 }, { name: 'v', value: 10, min: 5, max: 12 }] }), [['θ', 0.8, 0.2, 1.4], ['v', 10, 5, 12]])
  assert.deepEqual(sliders({ fns: [{ x: '2*cos(t)', y: '2*sqrt(1-e^2)*sin(t)' }], params: [{ name: 'e', value: 0.5, min: 0, max: 0.95 }] }), [['e', 0.5, 0, 0.95]])
  close(compilePlot(normalizePlot({ fns: ['e*x'], params: [{ name: 'e', value: 0.5, min: 0, max: 1 }] }))[0].y(2, [0.5]), 1)
  // The variable a curve runs over stays the curve's own.
  assert.deepEqual(sliders({ fns: [{ r: '1 + cos(θ)' }], params: [{ name: 'θ', min: 0, max: 1 }] }), [])
  assert.deepEqual(sliders({ fns: [{ x: 'cos(t)', y: 'sin(t)' }, 'k*x'], params: [{ name: 't', min: 0, max: 1 }, { name: 'k', min: 0, max: 2 }] }), [['k', 1, 0, 2]])
  assert.deepEqual(sliders({ fns: ['x^2 + y'], params: [{ name: 'y', min: 0, max: 1 }] }), null, 'y is never a slider')
  assert.deepEqual(sliders({ fns: ['pi*x'], params: [{ name: 'pi', min: 3, max: 4 }] }), [], 'π stays π')
  // Other ways to write a slider: its name under another key, a range, an
  // object of sliders, a bare name, ends missing, in the wrong order or equal.
  assert.deepEqual(sliders({ fns: ['k*x + b'], params: [{ param: 'k', value: 1, range: [0, 3] }, { var: 'b', value: 0, min: -2, max: 2 }] }), [['k', 1, 0, 3], ['b', 0, -2, 2]])
  assert.deepEqual(sliders({ fns: ['a*x^2 + b*x + c'], sliders: { a: { min: -2, max: 2, value: 1 }, b: [-3, 3], c: 0.5 } }), [['a', 1, -2, 2], ['b', 0, -3, 3], ['c', 0.5, 0, 1]])
  assert.deepEqual(sliders({ fns: ['k*x'], params: ['k'] }), [['k', 1, 0, 2]])
  assert.deepEqual(sliders({ fns: ['k*x'], params: [{ name: 'k', value: 4 }] }), [['k', 4, 0, 8]])
  assert.deepEqual(sliders({ fns: ['k*x'], params: [{ name: 'k', min: 2 }] }), [['k', 3, 2, 4]])
  assert.deepEqual(sliders({ fns: ['k*x'], params: [{ name: 'k', max: -1, value: -3 }] }), [['k', -3, -5, -1]])
  assert.deepEqual(sliders({ fns: ['k*x'], params: [{ name: 'k', min: 3, max: 1, value: 2 }] }), [['k', 2, 1, 3]])
  assert.deepEqual(sliders({ fns: ['k*x'], params: [{ name: 'k', min: 1, max: 1 }] }), [['k', 1, 0, 2]])
  assert.deepEqual(sliders({ fns: ['k*x'], params: [{ name: 'k', value: 0 }] }), [['k', 0, -1, 1]])
  assert.deepEqual(sliders({ fns: ['rate*x'], params: [{ name: 'rate', min: 0, max: 1 }] }), [['rate', 0.5, 0, 1]], 'names may be whole words')
  // A few sliders more than asked for are kept; one no curve reads is dropped.
  assert.deepEqual(sliders({ fns: ['a*x^4 + b*x^3 + c*x^2 + d*x + f'], params: ['a', 'b', 'c', 'd', 'f', 'g'].map(name => ({ name, value: 1, min: 0, max: 2 })) }).map(([name]) => name), ['a', 'b', 'c', 'd', 'f'])
  // A Greek letter answers to its name and its variant glyph.
  assert.deepEqual(sliders({ fns: ['A*sin(omega*x + ϕ)'], params: [{ name: 'A', min: 0, max: 2 }, { name: 'ω', min: 1, max: 3 }, { name: 'phi', min: 0, max: 3 }] }), [['A', 1, 0, 2], ['ω', 2, 1, 3], ['phi', 1.5, 0, 3]])
  const many = normalizePlot({ x: [-2, 2], fns: ['a*x^5 + b*x^4 + c*x^3 + d*x^2 + f*x + g'], params: ['a', 'b', 'c', 'd', 'f', 'g'].map(name => ({ name, value: 0, min: -1, max: 1 })) })
  assert.equal(many.params.length, 6)
  const bounds = plotBounds(many)
  assert.ok(bounds.y.max >= 6 && bounds.y.min <= -6, 'the axes still leave room for the sliders at their ends')
  // Normalizing again changes nothing.
  for (const raw of [{ fns: ['P*(1+r)^x'], params: [{ name: 'r', value: 0.05 }, { name: 'P', min: 1, max: 1 }] }, many]) assert.deepEqual(normalizePlot(normalizePlot(raw)), normalizePlot(raw))
})

test('formulas forgive LaTeX, brackets and a lost backslash', () => {
  close(value(String.raw`\frac{1}{x+1}`, ['x'], [1]), 0.5)
  close(value(String.raw`\sqrt{x} + \sqrt[3]{8}`, ['x'], [9]), 5)
  close(value(String.raw`e^{-x^2} \cdot 2`, ['x'], [0]), 2)
  close(value(String.raw`A\sin\left(\omega x\right)`, ['x', 'A', 'ω'], [1, 2, Math.PI / 2]), 2)
  close(value(String.raw`2\pi r`, ['r'], [1]), 2 * Math.PI)
  close(value(String.raw`v_{0} t - \tfrac{1}{2} g t^{2}`, ['t', 'v_0', 'g'], [1, 10, 10]), 5)
  close(value('[x+1]^2 - {x}', ['x'], [1]), 3)
  close(value('mod(x, 3) + sgn(-x)', ['x'], [-1]), 3)
  // "\frac" and "\theta" written in JSON with one backslash arrive as a form
  // feed and a tab.
  close(value(JSON.parse(String.raw`"\\frac{1}{2}*x"`), ['x'], [4]), 2)
  close(value(JSON.parse(String.raw`"\frac{1}{2}*x"`), ['x'], [4]), 2)
  close(value(JSON.parse(String.raw`"sin(\theta)"`), ['θ'], [Math.PI / 2]), 1)
  // A Greek letter under another spelling, only where no other name fits.
  close(value('omega*x', ['x', 'ω'], [2, 3]), 6)
  close(value('ω*x', ['x', 'omega'], [2, 3]), 6)
  assert.throws(() => parseExpr('omega*x', ['x']), /Unknown name/u)
})

test('curves are sampled from their formulas, and axes leave room for every slider position', () => {
  const plot = normalizePlot({ x: [0, 8], fns: [{ y: 'A*cos(ω*t)' }], params: [{ name: 'A', value: 5, min: 1, max: 8 }, { name: 'ω', value: 'pi/2', min: 0.5, max: 4 }] })
  const compiled = compilePlot(plot)
  const [points] = sampleCurves(plot, compiled, [5, Math.PI / 2])
  close(points[0][1], 5)
  const quarter = points.find(([t]) => Math.abs(t - 1) < 1e-9)
  assert.ok(Math.abs(quarter[1]) < 1e-9, 'x(1) = 5·cos(π/2) = 0')
  const bounds = plotBounds(plot, compiled)
  assert.ok(bounds.y.max >= 8 && bounds.y.min <= -8, 'the largest amplitude fits')
  // tan x shoots off at ±π/2: the axes keep the bulk of the curve.
  const tangent = normalizePlot({ x: ['-pi', 'pi'], fns: ['tan(x)'] })
  const range = plotBounds(tangent)
  assert.ok(range.y.max < 200 && range.y.min > -200, JSON.stringify(range))
})

test('plots are drawn as SVG with textbook axes', () => {
  const plot = normalizePlot({ x: ['-2pi', '2pi'], fns: [{ y: 'sin(x)' }], points: [{ x: 'pi/2', label: '最高点' }], lines: [{ y: 1 }], tangents: [{ fn: 0, x: 0, label: '切线' }], shade: [{ fn: 0, from: 0, to: 'pi', label: '面积 = 2' }] })
  const svg = plotSvg(plot)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 420 290"/u)
  assert.match(svg, />π\/2</u)
  assert.match(svg, />2π</u)
  assert.match(svg, />−π</u)
  assert.match(svg, />O</u, 'the origin is marked O')
  assert.match(svg, /y = sin\(x\)/u, 'the formula is written beside its curve')
  assert.match(svg, /最高点/u)
  assert.match(svg, /stroke-dasharray="6 5"/u, 'guides are dashed')
  assert.match(svg, /fill-opacity="0.18"/u, 'the area is shaded')
  // Only what the board's SVG allow-list keeps.
  const tags = new Set([...svg.matchAll(/<([a-z]+)\b/gu)].map(match => match[1]))
  assert.deepEqual([...tags].sort(), ['circle', 'line', 'path', 'svg', 'text'])
  assert.doesNotMatch(svg, /NaN|Infinity/u)
  // Sliders redraw the curve; an asymptote splits it.
  const wave = normalizePlot({ x: [0, 6], fns: ['A*sin(x)'], params: [{ name: 'A', value: 1, min: 0.5, max: 2 }] })
  assert.notEqual(plotSvg(wave, [1]), plotSvg(wave, [2]))
  const tan = plotSvg(normalizePlot({ x: ['-pi', 'pi'], fns: ['tan(x)'] }))
  const curve = [...tan.matchAll(/<path d="([^"]+)" fill="none"/gu)][0][1]
  assert.equal(curve.match(/M/gu).length, 3, 'tan x is drawn in three pieces')
  // Equal scales: a circle is as wide as it is tall.
  const circle = normalizePlot({ equal: true, x: [-2, 2], y: [-1, 1], fns: [{ x: 'cos(t)', y: 'sin(t)' }] })
  const drawn = plotSvg(circle)
  const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/u.exec(drawn).map(Number)
  const path = /<path d="([^"]+)" fill="none"/u.exec(drawn)[1]
  const xs = [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/gu)].map(match => [Number(match[1]), Number(match[2])])
  const spanX = Math.max(...xs.map(([x]) => x)) - Math.min(...xs.map(([x]) => x))
  const spanY = Math.max(...xs.map(([, y]) => y)) - Math.min(...xs.map(([, y]) => y))
  assert.ok(width === 420 && height > 0)
  assert.ok(Math.abs(spanX - spanY) < 2, `${spanX} × ${spanY}`)
})

test('the board takes plots under any name, and charts stay charts', () => {
  const board = normalizeBoard([{ say: '看图。', ops: [
    { t: 'plot', fns: [{ y: 'x^2' }], x: [-2, 2], caption: '抛物线' },
    { t: 'chart', fns: ['sin(x)'] },
    { t: 'graph', y: 'cos(x)' },
    { t: 'plot', series: [{ name: '测量', points: [[0, 1], [1, 2]] }] },
    { t: 'plot', fns: ['bad('] },
  ] }])
  assert.deepEqual(board.steps[0].ops.map(op => op.t), ['plot', 'plot', 'plot', 'chart', 'missing'], 'formulas make plots, data makes a chart, a broken plot says it could not be drawn')
  assert.deepEqual(board.steps[0].ops[4], { id: 'o5', t: 'missing', of: 'plot', caption: '', formula: 'y = bad(' })
  assert.equal(estimateHeight(board.steps[0].ops[0]), 9)
  assert.equal(estimateHeight({ ...board.steps[0].ops[0], params: [{}, {}] }), 9 + 2.2)
  assert.match(boardToPlainText(board), /\(plot: \{"fns":\[\{"kind":"fx","y":"x\^2"\}\]/u, 'prompts see the formulas')
  assert.match(boardToMarkdown(board), /> 📈 抛物线\n> 📈 y = x², x −2 … 2/u)
  assert.match(plotToText(board.steps[0].ops[0]), /y = x²/u)
})

test('a step that asks the learner to drag a slider keeps its plot and the slider', () => {
  const board = normalizeBoard([{ say: '拖动利率 r 的滑块，比较早存和晚存。', ops: [
    { t: 'title', text: '复利' },
    { t: 'plot', fns: [{ y: 'P*(1+r)^x', name: '早存' }, { y: 'P*(1+r)^(x-10)', name: '晚存', domain: [10, 40] }], x: [0, 40], params: [{ name: 'P', value: 1, min: 1, max: 5 }, { name: 'r', value: 0.05, min: 0.01, max: 0.1, label: '年利率 r' }] },
  ] }])
  const plot = board.steps[0].ops.find(op => op.t === 'plot')
  assert.deepEqual(plot.params.map(param => param.label || param.name), ['P', '年利率 r'])
  assert.notEqual(plotSvg(plot, [1, 0.01]), plotSvg(plot, [1, 0.1]), 'the slider moves the curves')
  assert.match(BOARD_SPEC, /Only a plot with "params" has sliders/u, 'the teacher is told when there is a slider to drag')
})

test('practice items may carry a plot as their figure', () => {
  const item = normalizeItem({ kind: 'number', prompt: '读出周期', answer: 4, plot: { x: [0, 8], fns: ['cos(pi*x/2)'] } })
  assert.equal(item.plot.fns[0].y, 'cos(pi*x/2)')
  assert.equal(normalizeItem({ kind: 'number', prompt: '读出周期', answer: 4, plot: { fns: ['oops('] } }).plot, undefined)
})

test('the harmonic-motion sample shows its wave as a plot with sliders', () => {
  const pack = JSON.parse(readFileSync(new URL('../samples/harmonic-motion.aha-course.json', import.meta.url), 'utf8'))
  const plots = Object.values(pack.boards).flatMap(board => board.steps.flatMap(step => step.ops)).filter(op => op.t === 'plot')
  assert.equal(plots.length, 1)
  assert.deepEqual(plots[0].params.map(param => param.name), ['A', 'ω'])
  assert.ok(plotSvg(plots[0]).includes('x(t)'))
})
