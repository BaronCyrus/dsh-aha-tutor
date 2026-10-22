// Formulas for plots, read without ever running them as code: a small parser
// turns calculator syntax ("A*sin(w*x)", "2x^2 − 3", "√(1 − x²)") into a
// tree, and the tree is evaluated over numbers only. Shared by the host,
// which checks a plot before it is saved, and the browser, which draws it.

export const EXPR_LIMITS = Object.freeze({ chars: 240, nodes: 400, depth: 40 })

export class ExprError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ExprError'
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
  floor: [1, Math.floor],
  ceil: [1, Math.ceil],
  round: [1, Math.round],
  min: [-2, Math.min],
  max: [-2, Math.max],
  pow: [2, Math.pow],
})

const CONSTANTS = Object.freeze({ pi: Math.PI, π: Math.PI, e: Math.E })

export const isFunctionName = name => Object.hasOwn(FUNCTIONS, name)
export const isConstantName = name => Object.hasOwn(CONSTANTS, name)

// Unicode a model or a textbook might write, in plain calculator syntax.
const REPLACEMENTS = [
  [/[−–—]/gu, '-'],
  [/[×·⋅∙]/gu, '*'],
  [/÷/gu, '/'],
  [/\*\*/gu, '^'],
  [/²/gu, '^2'],
  [/³/gu, '^3'],
  [/[（]/gu, '('],
  [/[）]/gu, ')'],
  [/[，]/gu, ','],
]

function tokenize(source) {
  let input = String(source ?? '')
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
    if ('+-*/^(),|√'.includes(char)) {
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
  const startsPrimary = token => token && (token.type === 'num' || token.type === 'name' || token.type === '(' || token.type === '√')

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
    const args = [nested(sum)]
    while (peek()?.type === ',') {
      take()
      args.push(nested(sum))
    }
    take(')')
    if (arity > 0 ? args.length !== arity : args.length < -arity) throw new ExprError(`${name} takes ${Math.abs(arity)} argument${Math.abs(arity) > 1 ? 's' : ''}`)
    return node({ k: 'call', f: name, args })
  }

  // A name: a variable, a parameter, a constant, a function call, or a run
  // of known names multiplied together.
  function named(value) {
    if (known.has(value)) return node({ k: 'var', n: value })
    if (isConstantName(value)) return node({ k: 'num', v: CONSTANTS[value] })
    if (isFunctionName(value)) {
      if (peek()?.type !== '(') throw new ExprError(`Write ${value}(…) with parentheses`)
      return call(value)
    }
    const parts = splitName(value)
    if (!parts) throw new ExprError(`Unknown name "${value}"`)
    let result = null
    for (const [partIndex, part] of parts.entries()) {
      let factor
      if (isFunctionName(part)) {
        if (partIndex !== parts.length - 1 || peek()?.type !== '(') throw new ExprError(`Unknown name "${value}"`)
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
      const inner = nested(sum)
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

  const tree = sum()
  if (index < tokens.length) throw new ExprError(`Unexpected "${tokens[index].type === 'name' || tokens[index].type === 'num' ? tokens[index].value : tokens[index].type}"`)
  return tree
}

// The names a tree reads, besides constants and functions.
export function namesIn(tree, found = new Set()) {
  if (tree.k === 'var') found.add(tree.n)
  else if (tree.k === 'neg') namesIn(tree.a, found)
  else if (tree.k === 'bin') {
    namesIn(tree.a, found)
    namesIn(tree.b, found)
  } else if (tree.k === 'call') for (const arg of tree.args) namesIn(arg, found)
  return found
}

// A function of an array of values, in the order of `names`. Never throws:
// outside its domain a formula gives NaN.
export function compileExpr(tree, names = []) {
  const slot = new Map(names.map((name, position) => [name, position]))
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
      case 'call': {
        const implementation = FUNCTIONS[item.f][1]
        const args = item.args.map(build)
        if (args.length === 1) {
          const [a] = args
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

// Plain Unicode for labels and exports: "A·sin(ωx)", "x² − 3", "√(1 − x²)".
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
      case 'call': {
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
