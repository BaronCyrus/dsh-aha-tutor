// Formulas for plots, read without ever running them as code: a small parser
// turns calculator syntax ("A*sin(w*x)", "2x^2 − 3", "√(1 − x²)") into a
// tree, and the tree is evaluated over numbers only. Shared by the host,
// which checks a plot before it is saved, and the browser, which draws it.
// A function given in pieces is written with comparisons and a choice:
// "if(x < 0, -x, x)", "piecewise(x < 0, 0, x < 1, x, 1)" or
// "x < 0 ? -x : x"; a comparison is 1 when it holds and 0 when not.

export const EXPR_LIMITS = Object.freeze({ chars: 240, nodes: 400, depth: 40 })

export class ExprError extends Error {
  // unknown: a name the formula uses that is neither given nor known; call:
  // a "(" follows it, so it was meant as a function.
  constructor(message, { unknown, call = false } = {}) {
    super(message)
    this.name = 'ExprError'
    if (unknown !== undefined) {
      this.unknown = unknown
      this.call = call
    }
  }
}

// name → [arity (negative: at least that many), implementation]
const FUNCTIONS = Object.freeze({
  sin: [1, Math.sin],
  cos: [1, Math.cos],
  tan: [1, Math.tan],
  cot: [1, x => 1 / Math.tan(x)],
  sec: [1, x => 1 / Math.cos(x)],
  csc: [1, x => 1 / Math.sin(x)],
  asin: [1, Math.asin],
  acos: [1, Math.acos],
  atan: [1, Math.atan],
  arcsin: [1, Math.asin],
  arccos: [1, Math.acos],
  arctan: [1, Math.atan],
  atan2: [2, Math.atan2],
  sinh: [1, Math.sinh],
  cosh: [1, Math.cosh],
  tanh: [1, Math.tanh],
  asinh: [1, Math.asinh],
  acosh: [1, Math.acosh],
  atanh: [1, Math.atanh],
  exp: [1, Math.exp],
  ln: [1, Math.log],
  log: [1, Math.log10],
  lg: [1, Math.log10],
  log10: [1, Math.log10],
  log2: [1, Math.log2],
  sqrt: [1, Math.sqrt],
  cbrt: [1, Math.cbrt],
  abs: [1, Math.abs],
  sign: [1, Math.sign],
  sgn: [1, Math.sign],
  mod: [2, (a, b) => a - b * Math.floor(a / b)],
  floor: [1, Math.floor],
  ceil: [1, Math.ceil],
  round: [1, Math.round],
  min: [-2, Math.min],
  max: [-2, Math.max],
  pow: [2, Math.pow],
  // if(condition, then, otherwise) and piecewise(condition₁, value₁,
  // condition₂, value₂, …, otherwise). compileExpr evaluates only the piece
  // in force; these say what that means.
  if: [3, (condition, yes, no) => choose([condition, yes, no])],
  piecewise: [-2, (...args) => choose(args)],
})

function choose(args) {
  for (let at = 0; at + 1 < args.length; at += 2) {
    if (Number.isNaN(args[at])) return NaN
    if (args[at]) return args[at + 1]
  }
  return args.length % 2 ? args[args.length - 1] : NaN
}

// The functions whose value jumps: a curve breaks where they change.
const STEPS = new Set(['floor', 'ceil', 'round', 'sign', 'sgn'])

const CONSTANTS = Object.freeze({ pi: Math.PI, π: Math.PI, e: Math.E })

export const isFunctionName = name => Object.hasOwn(FUNCTIONS, name)
export const isConstantName = name => Object.hasOwn(CONSTANTS, name)

// A Greek letter may be written as itself, as its name or as a variant
// glyph: a slider called "ω" also answers to "omega" in a formula.
const GREEK = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
})
const GREEK_VARIANTS = Object.freeze({ ϕ: 'φ', ϑ: 'θ', ϵ: 'ε', ϱ: 'ρ', ς: 'σ' })

// The Greek letter a name spells ("omega" → "ω", "ϕ" → "φ"), or null.
export function greekLetter(name) {
  return GREEK[name] ?? GREEK_VARIANTS[name] ?? null
}

function greekAliases(name) {
  const letter = GREEK[name] ?? GREEK_VARIANTS[name] ?? name
  const word = Object.keys(GREEK).find(key => GREEK[key] === letter)
  const variants = Object.keys(GREEK_VARIANTS).filter(key => GREEK_VARIANTS[key] === letter)
  return [letter, word, ...variants].filter(alias => alias && alias !== name)
}

// Unicode a model or a textbook might write, in plain calculator syntax.
const REPLACEMENTS = [
  [/[−–—]/gu, '-'],
  [/[×·⋅∙]/gu, '*'],
  [/÷/gu, '/'],
  [/\*\*/gu, '^'],
  [/²/gu, '^2'],
  [/³/gu, '^3'],
  [/[（[{]/gu, '('],
  [/[）\]}]/gu, ')'],
  [/[，]/gu, ','],
  [/[≤⩽]/gu, '<='],
  [/[≥⩾]/gu, '>='],
  [/≠/gu, '!='],
  [/＜/gu, '<'],
  [/＞/gu, '>'],
  [/＝/gu, '='],
  [/？/gu, '?'],
  [/：/gu, ':'],
  [/∧/gu, '&&'],
  [/∨/gu, '||'],
]

// LaTeX for comparing and joining conditions.
const LATEX_OPERATORS = Object.freeze({
  le: '<=', leq: '<=', leqslant: '<=', lt: '<', ge: '>=', geq: '>=', geqslant: '>=', gt: '>', ne: '!=', neq: '!=',
  land: '&&', wedge: '&&', lor: '||', vee: '||',
})

// The {…} group that opens at `at`: [its content, the index after it].
function group(text, at) {
  if (text[at] !== '{') return null
  let depth = 0
  for (let index = at; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return [text.slice(at + 1, index), index + 1]
    }
  }
  return null
}

const skipSpaces = (text, at) => {
  let index = at
  while (text[index] === ' ') index += 1
  return index
}

// LaTeX that slips into a formula: \frac{a}{b}, \sqrt[n]{x}, \cdot, \left(,
// \sin, \pi, e^{-x}, v_{0}. Commands it does not know keep their name.
function fromLatex(source) {
  // "\frac", "\theta" or "\beta" written in JSON with one backslash arrive
  // as a form feed, a tab or a backspace before the rest of the name.
  const text = source
    .replace(/\f/gu, '\\f')
    .replace(/\u0008/gu, '\\b')
    .replace(/[\t\r\n](?=[a-zA-Z])/gu, char => ({ '\t': '\\t', '\r': '\\r', '\n': '\\n' })[char])
  if (!text.includes('\\') && !text.includes('_{')) return text
  let out = ''
  let at = 0
  while (at < text.length) {
    const command = /^\\([a-zA-Z]+)/u.exec(text.slice(at))
    if (!command) {
      const subscript = /^_\{([\p{L}\p{N}]+)\}/u.exec(text.slice(at))
      const space = /^\\[,;:! ]/u.test(text.slice(at))
      out += subscript ? `_${subscript[1]}` : space ? ' ' : text[at]
      at += subscript ? subscript[0].length : space ? 2 : 1
      continue
    }
    const name = command[1]
    const next = skipSpaces(text, at + command[0].length)
    if (['frac', 'dfrac', 'tfrac'].includes(name)) {
      const top = group(text, next)
      const bottom = top && group(text, skipSpaces(text, top[1]))
      if (bottom) {
        out += `((${fromLatex(top[0])})/(${fromLatex(bottom[0])}))`
        at = bottom[1]
        continue
      }
    }
    if (name === 'sqrt') {
      const index = text[next] === '[' ? text.indexOf(']', next) : -1
      const radicand = group(text, skipSpaces(text, index >= 0 ? index + 1 : next))
      if (radicand) {
        out += index >= 0 ? `((${fromLatex(radicand[0])})^(1/(${fromLatex(text.slice(next + 1, index))})))` : `sqrt(${fromLatex(radicand[0])})`
        at = radicand[1]
        continue
      }
    }
    if (['mathrm', 'operatorname', 'text', 'mathit', 'mathbf'].includes(name)) {
      const inner = group(text, next)
      if (inner) {
        out += fromLatex(inner[0])
        at = inner[1]
        continue
      }
    }
    if (name === 'left' || name === 'right') {
      at = next
      continue
    }
    out += ['cdot', 'times', 'ast'].includes(name) ? '*' : name === 'div' ? '/' : LATEX_OPERATORS[name] ? ` ${LATEX_OPERATORS[name]} ` : name
    at += command[0].length
  }
  return out
}

function tokenize(source) {
  let input = fromLatex(String(source ?? ''))
  for (const [pattern, value] of REPLACEMENTS) input = input.replace(pattern, value)
  const tokens = []
  let at = 0
  while (at < input.length) {
    const char = input[at]
    if (/\s/u.test(char)) {
      at += 1
      continue
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(input.slice(at))
    if (number) {
      tokens.push({ type: 'num', value: Number(number[0]) })
      at += number[0].length
      continue
    }
    const name = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(input.slice(at))
    if (name) {
      tokens.push({ type: 'name', value: name[0] })
      at += name[0].length
      continue
    }
    // "||" stays two bars: the parser tells it from |x| by where it stands.
    const pair = input.slice(at, at + 2)
    if (['<=', '>=', '==', '!=', '&&'].includes(pair)) {
      tokens.push({ type: pair === '==' ? '=' : pair })
      at += 2
      continue
    }
    if (char === '&') {
      tokens.push({ type: '&&' })
      at += 1
      continue
    }
    if ('+-*/^(),|√<>=?:'.includes(char)) {
      tokens.push({ type: char })
      at += 1
      continue
    }
    throw new ExprError(`Unexpected "${char}"`)
  }
  return tokens
}

// Parses `source` into a tree whose names are all `names` (variables and
// parameters), constants or functions. A run of letters that is not a known
// name is read as a product of known ones, as in "kx" or "2ax".
export function parseExpr(source, names = []) {
  const text = String(source ?? '')
  if (!text.trim()) throw new ExprError('Empty formula')
  if (text.length > EXPR_LIMITS.chars) throw new ExprError('Formula too long')
  const known = new Set(names)
  const tokens = tokenize(text)
  let index = 0
  let nodes = 0
  let depth = 0
  const peek = () => tokens[index]
  const take = type => {
    const token = tokens[index]
    if (!token || (type && token.type !== type)) throw new ExprError(type ? `Expected "${type}"` : 'Unexpected end')
    index += 1
    return token
  }
  const node = value => {
    nodes += 1
    if (nodes > EXPR_LIMITS.nodes) throw new ExprError('Formula too long')
    return value
  }
  const nested = parse => {
    depth += 1
    if (depth > EXPR_LIMITS.depth) throw new ExprError('Formula nested too deeply')
    try {
      return parse()
    } finally {
      depth -= 1
    }
  }
  const word = (token, value) => token?.type === 'name' && token.value === value
  const startsPrimary = token => token && (token.type === 'num' || (token.type === 'name' && !KEYWORDS.has(token.value)) || token.type === '(' || token.type === '√')

  // c ? a : b, grouped from the right: c₁ ? a : c₂ ? b : d.
  function choice() {
    const condition = either()
    if (peek()?.type !== '?') return condition
    take()
    const yes = nested(choice)
    take(':')
    const no = nested(choice)
    return node({ k: 'call', f: 'if', args: [condition, yes, no] })
  }

  function either() {
    let left = both()
    for (;;) {
      if (word(peek(), 'or')) take()
      else if (peek()?.type === '|' && tokens[index + 1]?.type === '|') index += 2
      else return left
      left = node({ k: 'or', a: left, b: both() })
    }
  }

  function both() {
    let left = comparison()
    while (word(peek(), 'and') || peek()?.type === '&&') {
      take()
      left = node({ k: 'and', a: left, b: comparison() })
    }
    return left
  }

  // a < b ≤ c holds when both comparisons do, as in a textbook.
  function comparison() {
    const first = sum()
    if (!COMPARISONS.has(peek()?.type)) return first
    const args = [first]
    const ops = []
    while (COMPARISONS.has(peek()?.type)) {
      ops.push(take().type)
      args.push(sum())
    }
    return node({ k: 'cmp', ops, args })
  }

  function sum() {
    let left = product()
    while (peek()?.type === '+' || peek()?.type === '-') {
      const op = take().type
      left = node({ k: 'bin', op, a: left, b: product() })
    }
    return left
  }

  function product() {
    let left = unary()
    for (;;) {
      const token = peek()
      if (token?.type === '*' || token?.type === '/') {
        take()
        left = node({ k: 'bin', op: token.type, a: left, b: unary() })
      } else if (startsPrimary(token)) {
        left = node({ k: 'bin', op: '*', a: left, b: power() })
      } else {
        return left
      }
    }
  }

  function unary() {
    const token = peek()
    if (token?.type === '-') {
      take()
      return node({ k: 'neg', a: nested(unary) })
    }
    if (token?.type === '+') {
      take()
      return nested(unary)
    }
    return power()
  }

  function power() {
    const base = primary()
    if (peek()?.type !== '^') return base
    take()
    return node({ k: 'bin', op: '^', a: base, b: nested(unary) })
  }

  function call(name) {
    const [arity] = FUNCTIONS[name]
    take('(')
    const args = [nested(choice)]
    while (peek()?.type === ',') {
      take()
      args.push(nested(choice))
    }
    take(')')
    if (arity > 0 ? args.length !== arity : args.length < -arity) throw new ExprError(`${name} takes ${Math.abs(arity)} argument${Math.abs(arity) > 1 ? 's' : ''}`)
    return node({ k: 'call', f: name, args })
  }

  // A name: a variable, a parameter (also under another spelling of its
  // Greek letter), a constant, a function call, or a run of known names
  // multiplied together.
  function named(value) {
    if (known.has(value)) return node({ k: 'var', n: value })
    const alias = greekAliases(value).find(name => known.has(name))
    if (alias) return node({ k: 'var', n: alias })
    if (isConstantName(value)) return node({ k: 'num', v: CONSTANTS[value] })
    if (KEYWORDS.has(value)) throw new ExprError(`Unexpected "${value}"`)
    if (isFunctionName(value)) {
      if (peek()?.type !== '(') throw new ExprError(`Write ${value}(…) with parentheses`)
      return call(value)
    }
    const parts = splitName(value)
    if (!parts) throw new ExprError(`Unknown name "${value}"`, { unknown: value, call: peek()?.type === '(' })
    let result = null
    for (const [partIndex, part] of parts.entries()) {
      let factor
      if (isFunctionName(part)) {
        if (partIndex !== parts.length - 1 || peek()?.type !== '(') throw new ExprError(`Unknown name "${value}"`, { unknown: value })
        factor = call(part)
      } else factor = node(known.has(part) ? { k: 'var', n: part } : { k: 'num', v: CONSTANTS[part] })
      result = result ? node({ k: 'bin', op: '*', a: result, b: factor }) : factor
    }
    return result
  }

  // Longest known names first; a function may only come last.
  function splitName(value) {
    const candidates = [...known, ...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS)].sort((a, b) => b.length - a.length)
    const parts = []
    let rest = value
    while (rest) {
      const found = candidates.find(candidate => rest.startsWith(candidate))
      if (!found) return null
      parts.push(found)
      rest = rest.slice(found.length)
    }
    return parts.length > 1 ? parts : null
  }

  function primary() {
    const token = take()
    if (token.type === 'num') return node({ k: 'num', v: token.value })
    if (token.type === 'name') return named(token.value)
    if (token.type === '(') {
      const inner = nested(choice)
      take(')')
      return inner
    }
    if (token.type === '|') {
      const inner = nested(sum)
      take('|')
      return node({ k: 'call', f: 'abs', args: [inner] })
    }
    if (token.type === '√') return node({ k: 'call', f: 'sqrt', args: [nested(power)] })
    throw new ExprError(`Unexpected "${token.type}"`)
  }

  const tree = choice()
  if (index < tokens.length) throw new ExprError(`Unexpected "${tokens[index].type === 'name' || tokens[index].type === 'num' ? tokens[index].value : tokens[index].type}"`)
  return tree
}

// Words that join conditions, never names: "x > 0 and x < 1".
const KEYWORDS = new Set(['and', 'or'])
const COMPARISONS = new Set(['<', '<=', '>', '>=', '=', '!='])
const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))
const COMPARE = Object.freeze({
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b || near(a, b),
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b || near(a, b),
  '=': near,
  '!=': (a, b) => !near(a, b),
})

// The names a tree reads, besides constants and functions.
export function namesIn(tree, found = new Set()) {
  if (tree.k === 'var') found.add(tree.n)
  else if (tree.k === 'neg') namesIn(tree.a, found)
  else if (tree.k === 'bin' || tree.k === 'and' || tree.k === 'or') {
    namesIn(tree.a, found)
    namesIn(tree.b, found)
  } else if (tree.k === 'call' || tree.k === 'cmp') for (const arg of tree.args) namesIn(arg, found)
  return found
}

// A function of an array of values, in the order of `names`. Never throws:
// outside its domain a formula gives NaN, and so does a condition there.
// trace, when given, follows the pieces an evaluation goes through: each
// comparison, choice and step (floor, sign…) folds its outcome into
// trace.sig, so two points whose signatures differ lie on different pieces
// and a curve is not drawn across the jump between them (plot.js).
export function compileExpr(tree, names = [], trace = null) {
  const slot = new Map(names.map((name, position) => [name, position]))
  const note = trace ? value => { trace.sig = (trace.sig * 31 + (Number.isFinite(value) ? value : 0) + 7) % 1_000_000_007 } : () => {}
  const build = item => {
    switch (item.k) {
      case 'num': {
        const value = item.v
        return () => value
      }
      case 'var': {
        const position = slot.get(item.n)
        if (position === undefined) throw new ExprError(`Unknown name "${item.n}"`)
        return values => values[position]
      }
      case 'neg': {
        const a = build(item.a)
        return values => -a(values)
      }
      case 'bin': {
        const a = build(item.a)
        const b = build(item.b)
        if (item.op === '+') return values => a(values) + b(values)
        if (item.op === '-') return values => a(values) - b(values)
        if (item.op === '*') return values => a(values) * b(values)
        if (item.op === '/') return values => a(values) / b(values)
        return values => power(a(values), b(values))
      }
      case 'cmp': {
        const args = item.args.map(build)
        const tests = item.ops.map(op => COMPARE[op])
        return values => {
          let left = args[0](values)
          for (let at = 0; at < tests.length; at += 1) {
            const right = args[at + 1](values)
            if (Number.isNaN(left) || Number.isNaN(right)) return NaN
            if (!tests[at](left, right)) {
              note(0)
              return 0
            }
            left = right
          }
          note(1)
          return 1
        }
      }
      case 'and':
      case 'or': {
        const a = build(item.a)
        const b = build(item.b)
        const settled = item.k === 'and' ? 0 : 1
        return values => {
          const left = a(values)
          if (Number.isNaN(left)) return NaN
          if ((left ? 1 : 0) === settled) return settled
          const right = b(values)
          return Number.isNaN(right) ? NaN : right ? 1 : 0
        }
      }
      case 'call': {
        const args = item.args.map(build)
        // Only the piece in force is evaluated, and the signature says which.
        if (item.f === 'if' || item.f === 'piecewise') {
          const pieces = Math.floor(args.length / 2)
          const otherwise = args.length % 2 ? args[args.length - 1] : null
          return values => {
            for (let piece = 0; piece < pieces; piece += 1) {
              const condition = args[piece * 2](values)
              if (Number.isNaN(condition)) return NaN
              if (condition) {
                note(piece + 2)
                return args[piece * 2 + 1](values)
              }
            }
            note(1)
            return otherwise ? otherwise(values) : NaN
          }
        }
        const implementation = FUNCTIONS[item.f][1]
        if (item.f === 'mod') {
          const [a, b] = args
          return values => {
            const top = a(values)
            const bottom = b(values)
            note(Math.floor(top / bottom))
            return implementation(top, bottom)
          }
        }
        if (args.length === 1) {
          const [a] = args
          if (STEPS.has(item.f)) {
            return values => {
              const result = implementation(a(values))
              note(result)
              return result
            }
          }
          return values => implementation(a(values))
        }
        return values => implementation(...args.map(arg => arg(values)))
      }
      default:
        throw new ExprError('Bad formula')
    }
  }
  return build(tree)
}

// x^(p/q) of a negative x is real when q is odd: (−8)^(1/3) = −2.
function power(base, exponent) {
  const value = base ** exponent
  if (!Number.isNaN(value) || base >= 0 || !Number.isFinite(exponent)) return value
  for (const denominator of [3, 5, 7, 9]) {
    const numerator = Math.round(exponent * denominator)
    if (Math.abs(numerator / denominator - exponent) < 1e-9) {
      const root = -((-base) ** (1 / denominator))
      return root ** numerator
    }
  }
  return value
}

// Parse and compile in one go: { tree, evaluate }.
export function formula(source, names = []) {
  const tree = parseExpr(source, names)
  return { tree, evaluate: compileExpr(tree, names) }
}

// A number written as a number or as a constant formula ("2*pi", "-π/2").
export function constantValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const result = compileExpr(parseExpr(value))([])
    return Number.isFinite(result) ? result : null
  } catch {
    return null
  }
}

// ── reading a formula back ────────────────────────────────────────────────

const SUPERSCRIPT = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' }
const DISPLAY_NAMES = { pi: 'π', theta: 'θ', omega: 'ω', phi: 'φ', alpha: 'α', beta: 'β', lambda: 'λ', mu: 'μ', sigma: 'σ', tau: 'τ' }
const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 }

function formatNumber(value) {
  if (Math.abs(value - Math.PI) < 1e-12) return 'π'
  if (Math.abs(value - Math.E) < 1e-12) return 'e'
  return Number(value.toPrecision(6)).toString()
}

const superscript = value => [...String(value)].map(char => SUPERSCRIPT[char]).join('')
const symbol = value => [...value].length === 1 && /\p{L}/u.test(value)
const COMPARISON_TEXT = Object.freeze({ '<': '<', '<=': '≤', '>': '>', '>=': '≥', '=': '=', '!=': '≠' })
const NEGATED = Object.freeze({ '<': '>=', '<=': '>', '>': '<=', '>=': '<', '=': '!=', '!=': '=' })

// A function in pieces as [condition, value] pairs, read in order; a chain
// of choices is one list. The last value, "otherwise", has no condition,
// unless the one before it is a single comparison it can be the opposite of.
function piecesOf(item) {
  const pairs = []
  let current = item
  for (;;) {
    for (let at = 0; at + 1 < current.args.length; at += 2) pairs.push([current.args[at], current.args[at + 1]])
    if (current.args.length % 2 === 0) return pairs
    const rest = current.args[current.args.length - 1]
    if (rest.k === 'call' && (rest.f === 'if' || rest.f === 'piecewise')) {
      current = rest
      continue
    }
    const only = pairs.length === 1 ? pairs[0][0] : null
    const opposite = only?.k === 'cmp' && only.ops.length === 1 ? { ...only, ops: [NEGATED[only.ops[0]]] } : null
    return [...pairs, [opposite, rest]]
  }
}

// Plain Unicode for labels and exports: "A·sin(ωx)", "x² − 3", "√(1 − x²)";
// a function in pieces reads "−x (x < 0); x (x ≥ 0)".
export function exprToText(tree, display = DISPLAY_NAMES) {
  const show = name => display[name] ?? name
  const write = (item, parent = 0) => {
    switch (item.k) {
      case 'num':
        return formatNumber(item.v)
      case 'var':
        return show(item.n)
      case 'neg': {
        const inner = write(item.a, 3)
        return parent > 2 ? `(−${inner})` : `−${inner}`
      }
      case 'cmp': {
        const out = item.args.map((arg, at) => `${at ? ` ${COMPARISON_TEXT[item.ops[at - 1]]} ` : ''}${write(arg, 1)}`).join('')
        return parent > 0.5 ? `(${out})` : out
      }
      case 'and':
      case 'or': {
        const out = `${write(item.a, 0.5)} ${item.k} ${write(item.b, 0.5)}`
        return parent > 0.4 ? `(${out})` : out
      }
      case 'call': {
        if (item.f === 'if' || item.f === 'piecewise') {
          const out = piecesOf(item).map(([condition, value]) => (condition ? `${write(value)} (${write(condition)})` : write(value))).join('; ')
          return parent > 0 ? `{${out}}` : out
        }
        if (item.f === 'abs') return `|${write(item.args[0])}|`
        if (item.f === 'sqrt') return `√(${write(item.args[0])})`
        return `${item.f}(${item.args.map(arg => write(arg)).join(', ')})`
      }
      case 'bin': {
        const own = PRECEDENCE[item.op]
        let out
        if (item.op === '^') {
          const base = write(item.a, 5)
          const integer = value => value.k === 'num' && Number.isInteger(value.v) && Math.abs(value.v) < 100
          const top = write(item.b)
          const exponent = integer(item.b) ? superscript(item.b.v)
            : item.b.k === 'neg' && integer(item.b.a) ? `⁻${superscript(item.b.a.v)}`
              : symbol(top) ? `^${top}` : `^(${top})`
          out = `${base}${exponent}`
        } else if (item.op === '*') {
          // A product on the right needs no brackets: a·(b·c) reads as a·b·c.
          const a = write(item.a, own)
          const b = write(item.b, own)
          // "2x", "2(x + 1)", "πx", "(x + 1)(x − 1)"; "A·sin(ωx)" and "x·2" keep their dot.
          const tight = (item.a.k === 'num' && /\d$/u.test(a) && /^[\p{L}(√|]/u.test(b))
            || (symbol(a) && (symbol(b) || b.startsWith('(')))
            || (item.a.k !== 'call' && /^[\d\p{L}]+$/u.test(a) && /\p{L}$/u.test(a) && symbol(b))
            || (item.a.k !== 'call' && a.endsWith(')') && b.startsWith('('))
          out = tight ? `${a}${b}` : `${a}·${b}`
        } else {
          // a + (b − c) reads as a + b − c; a − (b + c) and a / (b·c) keep theirs.
          const a = write(item.a, own)
          const b = write(item.b, item.op === '+' ? own : own + 0.5)
          out = `${a} ${item.op === '-' ? '−' : item.op} ${b}`
        }
        return own < parent ? `(${out})` : out
      }
      default:
        return ''
    }
  }
  return write(tree)
}
