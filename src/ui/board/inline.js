// Inline board text: **bold**, ==highlight==, $math$ and plain runs, with a
// visible length so text can be "written" a character at a time.

// A formula is one token wherever it stands, so "==" or "**" inside it never
// opens a style, and a bold or highlighted run may contain formulas. A
// highlight may hold a single "=" ("==乘积 = 0==").
const MATH = /\$[^$\n]+\$/gu
const TOKEN = /(\$[^$\n]+\$|\*\*(?:\$[^$\n]+\$|[^*\n])+?\*\*|==(?:\$[^$\n]+\$|=(?!=)|[^=\n])+?==)/gu

// Formulas inside a styled run keep its style: "==以 $a$ 为边==" highlights a
// rendered a instead of the raw "$a$".
function pushStyled(segments, text, kind) {
  let last = 0
  for (const match of text.matchAll(MATH)) {
    if (match.index > last) segments.push({ kind, text: text.slice(last, match.index) })
    segments.push({ kind: 'math', tex: match[0].slice(1, -1), style: kind })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ kind, text: text.slice(last) })
}

export function parseInline(value) {
  const segments = []
  const source = String(value ?? '')
  let last = 0
  for (const match of source.matchAll(TOKEN)) {
    if (match.index > last) segments.push({ kind: 'text', text: source.slice(last, match.index) })
    const token = match[0]
    if (token.startsWith('$')) segments.push({ kind: 'math', tex: token.slice(1, -1) })
    else pushStyled(segments, token.slice(2, -2), token.startsWith('**') ? 'bold' : 'mark')
    last = match.index + token.length
  }
  if (last < source.length) segments.push({ kind: 'text', text: source.slice(last) })
  return segments
}

export function segmentLength(segment) {
  return segment.kind === 'math' ? Math.min(10, Math.max(2, segment.tex.length / 2)) : [...segment.text].length
}

export function inlineLength(segments) {
  return segments.reduce((sum, segment) => sum + segmentLength(segment), 0)
}

// Cut segments to the first `count` visible characters. A formula appears
// whole once its share of the budget is reached.
export function sliceInline(segments, count) {
  const out = []
  let left = count
  for (const segment of segments) {
    if (left <= 0) break
    const length = segmentLength(segment)
    if (segment.kind === 'math') {
      if (left >= length) out.push(segment)
      left -= length
      continue
    }
    const chars = [...segment.text]
    if (chars.length <= left) out.push(segment)
    else out.push({ ...segment, text: chars.slice(0, Math.max(0, Math.floor(left))).join('') })
    left -= chars.length
  }
  return out
}

// Plain-text reading of inline markup (captions, exports).
export function inlinePlain(value) {
  return parseInline(value).map(segment => (segment.kind === 'math' ? segment.tex : segment.text)).join('')
}

// ── formulas as readable text ───────────────────────────────────────────────

const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', varkappa: 'ϰ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' }
// Long arrows read as the short ones: voices know →, fewer know ⟶.
const SYMBOLS = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', bullet: '•', oplus: '⊕', otimes: '⊗', odot: '⊙', setminus: '∖', backslash: '∖',
  le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥', lt: '<', gt: '>', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', cong: '≅', simeq: '≃', sim: '∼', propto: '∝', ll: '≪', gg: '≫', doteq: '≐',
  mid: '|', vert: '|', lvert: '|', rvert: '|', Vert: '‖', lVert: '‖', rVert: '‖', parallel: '∥', perp: '⊥',
  to: '→', rightarrow: '→', longrightarrow: '→', gets: '←', leftarrow: '←', longleftarrow: '←', leftrightarrow: '↔', longleftrightarrow: '↔', Rightarrow: '⇒', Longrightarrow: '⇒', implies: '⇒', Leftarrow: '⇐', Longleftarrow: '⇐', impliedby: '⇐', Leftrightarrow: '⇔', Longleftrightarrow: '⇔', iff: '⇔',
  mapsto: '↦', longmapsto: '↦', uparrow: '↑', downarrow: '↓', Uparrow: '⇑', Downarrow: '⇓', updownarrow: '↕', nearrow: '↗', searrow: '↘', rightleftharpoons: '⇌', leftrightharpoons: '⇋', rightharpoonup: '⇀', hookrightarrow: '↪',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', subsetneq: '⊊', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨', therefore: '∴', because: '∵',
  sum: 'Σ', prod: 'Π', int: '∫', iint: '∬', iiint: '∭', oint: '∮', partial: '∂', nabla: '∇', infty: '∞', hbar: 'ħ', ell: 'ℓ', aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ',
  degree: '°', circ: '°', prime: '′', angle: '∠', measuredangle: '∡', triangle: '△', square: '□',
  ldots: '…', dots: '…', dotsc: '…', cdots: '⋯', dotsb: '⋯', vdots: '⋮', ddots: '⋱',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', colon: ':',
}
const SUPER = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', T: 'ᵀ' }
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', n: 'ₙ', x: 'ₓ', k: 'ₖ', t: 'ₜ' }
// Function names KaTeX sets upright, read as words: "sin θ", "log₂ 8".
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'arg', 'gcd', 'hom', 'Pr'])
// A condition over or under an arrow or an equals sign follows it in brackets: →(光), =(点燃).
const LABELLED = { xrightarrow: '→', xleftarrow: '←', xRightarrow: '⇒', xLeftarrow: '⇐', xleftrightarrow: '↔', xLeftrightarrow: '⇔', xrightleftharpoons: '⇌', xleftrightharpoons: '⇋', xhookrightarrow: '↪', xmapsto: '↦', xlongequal: '=', xtofrom: '⇄' }
// Marks over letters as combining characters: D̄, v⃗, ŷ.
const ACCENTS = { bar: '\u0304', overline: '\u0305', vec: '\u20d7', overrightarrow: '\u20d7', overleftarrow: '\u20d6', overleftrightarrow: '\u20e1', hat: '\u0302', widehat: '\u0302', tilde: '\u0303', widetilde: '\u0303', check: '\u030c', breve: '\u0306', acute: '\u0301', grave: '\u0300', dot: '\u0307', ddot: '\u0308', mathring: '\u030a' }
const DOUBLE_STRUCK = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' }
// Styles, boxes and strike-outs: their argument reads as it is.
const AS_IS = new Set(['text', 'textrm', 'textbf', 'textit', 'textsf', 'texttt', 'textnormal', 'textup', 'emph', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal', 'mathscr', 'mathfrak', 'mathnormal', 'boldsymbol', 'bm', 'pmb', 'mbox', 'hbox', 'boxed', 'fbox', 'underline', 'cancel', 'bcancel', 'xcancel', 'sout', 'smash', 'mathop', 'mathord', 'mathrel', 'mathbin', 'mathpunct', 'mathopen', 'mathclose', 'mathinner', 'url'])
// Labels, colors, spacing and invisible boxes: their argument is not shown.
const DROPPED = new Set(['label', 'color', 'phantom', 'hphantom', 'vphantom', 'hspace', 'hspace*', 'vspace', 'vspace*', 'mspace', 'mkern', 'kern', 'hskip', 'mskip'])
const SPACES = { ',': ' ', ':': ' ', ';': ' ', '>': ' ', ' ': ' ', '!': '', quad: ' ', qquad: '  ', enspace: ' ', thinspace: ' ', medspace: ' ', thickspace: ' ', space: ' ', nobreakspace: ' ' }
const SILENT = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'limits', 'nolimits', 'notag', 'nonumber', 'hline', 'hdashline', 'allowbreak', 'nobreak', 'relax', 'strut', 'negthinspace', 'negmedspace', 'negthickspace'])
// Sizes before a bracket, which is read; "\left." is no bracket at all.
const SIZED = /^(?:left|right|middle|[bB]igg?[lrm]?)$/u
const STARRED = new Set(['operatorname', 'tag', 'hspace', 'vspace'])
// Matrices: cells apart by commas, rows by semicolons, in their brackets.
const MATRICES = { matrix: '', smallmatrix: '', array: '', darray: '', pmatrix: '()', bmatrix: '[]', Bmatrix: '{}', vmatrix: '||', Vmatrix: '‖‖' }
// A fraction's part is bracketed unless it is one number or one symbol with
// its indices and marks: 10/16, x²/2, (hc)/λ.
const ATOM = /^(?:[\d.]+|[\p{L}\p{N}][\p{M}\p{Lm}′'⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]*)$/u
// Placeholders while reading: after a function name, between cells, between rows.
const AFTER_NAME = '\u0001'
const CELL = '\u0002'
const ROW = '\u0003'

// Own keys only, so "\constructor" is no symbol.
const lookup = (map, key) => (Object.hasOwn(map, key) ? map[key] : undefined)
const grouped = value => (ATOM.test(value) ? value : `(${value})`)
const script = (value, map) => [...value.replace(/\s+/gu, '')].map(char => map[char] ?? char).join('')
const labelled = (base, labels) => {
  const label = labels.map(value => value.trim()).filter(Boolean).join(', ')
  return label ? `${base}(${label})` : base
}

// Parts joined by `separator`, or by a space after one that ends in punctuation.
function joined(parts, separator) {
  return parts.map(part => part.trim()).filter(Boolean).reduce((out, part) => (!out ? part : `${out}${/[,，;；:：]$/u.test(out) ? ' ' : separator}${part}`), '')
}

// Rows apart by semicolons and cells by `cell` (multi-line formulas, cases, matrices).
function rows(value, cell) {
  if (!value.includes(ROW) && !value.includes(CELL)) return value
  return joined(value.split(ROW).map(row => joined(row.split(CELL), cell)), '; ')
}

// One level of TeX read as text, with placeholders where it has cells and rows.
function readTex(source) {
  let at = 0
  let out = ''
  const skipSpaces = () => { while (/\s/u.test(source[at] ?? '')) at += 1 }
  // The text inside a balanced {group} or [bracket] that starts at `at`.
  const raw = (open, close) => {
    const start = at + 1
    let depth = 0
    for (; at < source.length; at += 1) {
      if (source[at] === '\\') at += 1
      else if (source[at] === open) depth += 1
      else if (source[at] === close && (depth -= 1) === 0) return source.slice(start, at++)
    }
    return source.slice(start)
  }
  const name = () => {
    const start = at
    while (/[a-zA-Z]/u.test(source[at] ?? '')) at += 1
    if (at === start) return source[at++] ?? ''
    if (source[at] === '*' && STARRED.has(source.slice(start, at))) at += 1
    return source.slice(start, at)
  }
  // An argument: a {group}, a command or a single character.
  const argument = () => {
    skipSpaces()
    if (at >= source.length) return ''
    if (source[at] === '{') return rows(readTex(raw('{', '}')), ' ')
    if (source[at] === '\\') {
      at += 1
      return command(name())
    }
    const char = String.fromCodePoint(source.codePointAt(at))
    at += char.length
    return char
  }
  const optional = () => {
    skipSpaces()
    return source[at] === '[' ? rows(readTex(raw('[', ']')), ' ') : ''
  }
  // \begin{kind} … \end{kind}, nested ones of the same kind included.
  const environment = () => {
    const kind = argument().trim()
    if (/^(?:d?array|subarray|alignat\*?|alignedat)$/u.test(kind)) argument()
    const open = `\\begin{${kind}}`
    const close = `\\end{${kind}}`
    let depth = 1
    let scan = at
    let end = source.length
    while (scan < source.length) {
      const nextClose = source.indexOf(close, scan)
      if (nextClose < 0) break
      const nextOpen = source.indexOf(open, scan)
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1
        scan = nextOpen + open.length
        continue
      }
      depth -= 1
      if (!depth) {
        end = nextClose
        break
      }
      scan = nextClose + close.length
    }
    const body = readTex(source.slice(at, end))
    at = Math.min(source.length, end + close.length)
    const brackets = lookup(MATRICES, kind)
    if (brackets !== undefined) return `${brackets.charAt(0)}${rows(body, ', ')}${brackets.charAt(1)}`
    return rows(body, /^d?r?cases\*?$/u.test(kind) ? ', ' : ' ')
  }
  const command = word => {
    const symbol = lookup(SPACES, word) ?? lookup(GREEK, word) ?? lookup(SYMBOLS, word)
    if (symbol !== undefined) return symbol
    if (SILENT.has(word)) return ''
    if (SIZED.test(word)) {
      skipSpaces()
      if (source[at] === '.') at += 1
      return ''
    }
    if (FUNCTIONS.has(word)) return `${word}${AFTER_NAME}`
    const arrow = lookup(LABELLED, word)
    if (arrow) {
      const below = optional()
      return labelled(arrow, [argument(), below])
    }
    const accent = lookup(ACCENTS, word)
    if (accent) return [...argument()].map(char => (/\s/u.test(char) ? char : `${char}${accent}`)).join('')
    if (AS_IS.has(word)) return argument()
    if (DROPPED.has(word)) {
      // "\kern2mu" takes a length, "\label{…}" an argument.
      const length = /^\s*-?[\d.]+\s*(?:em|ex|mu|pt|px|cm|mm|in|bp|pc|dd|cc|sp)/u.exec(source.slice(at))
      if (length) at += length[0].length
      else argument()
      return ' '
    }
    switch (word) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac': {
        const top = argument()
        return `${grouped(top)}/${grouped(argument())}`
      }
      case 'binom':
      case 'dbinom':
      case 'tbinom': {
        const n = argument()
        return `C(${n}, ${argument()})`
      }
      case 'sqrt': {
        const index = optional()
        return `${script(index, SUPER)}√${grouped(argument())}`
      }
      case 'overset':
      case 'underset':
      case 'stackrel': {
        const label = argument()
        return labelled(argument(), [label])
      }
      case 'overbrace':
      case 'underbrace': {
        const body = argument()
        skipSpaces()
        if (source[at] !== '^' && source[at] !== '_') return body
        at += 1
        return labelled(body, [argument()])
      }
      case 'mathbb':
      case 'Bbb':
        return [...argument()].map(char => DOUBLE_STRUCK[char] ?? char).join('')
      case 'operatorname':
      case 'operatorname*':
        return `${argument()}${AFTER_NAME}`
      case 'textcolor':
      case 'colorbox':
      case 'href':
        argument()
        return argument()
      case 'fcolorbox':
        argument()
        argument()
        return argument()
      case 'tag':
        return ` (${argument()})`
      case 'tag*':
        return ` ${argument()}`
      case 'pmod':
        return ` (mod ${argument()})`
      case 'pod':
        return ` (${argument()})`
      case 'bmod':
      case 'mod':
        return ' mod '
      case 'not':
        return `${argument()}\u0338`
      case 'begin':
        return environment()
      case 'end':
        argument()
        return ''
      case '\\':
      case 'cr':
      case 'newline':
        optional()
        return ROW
      case '|':
        return '‖'
      // \% \{ \_ and the like are the character; an unknown command is left
      // out, and what follows it reads as it is.
      default:
        return word.length === 1 && !/[a-zA-Z]/u.test(word) ? word : ''
    }
  }
  while (at < source.length) {
    const char = source[at]
    if (char === '\\') {
      at += 1
      out += command(name())
    } else if (char === '{') {
      out += readTex(raw('{', '}'))
    } else if (char === '^' || char === '_') {
      at += 1
      out += script(argument(), char === '^' ? SUPER : SUB)
    } else {
      at += 1
      out += char === '&' ? CELL : char === '~' ? ' ' : char === '}' ? '' : char
    }
  }
  return out
}

// Readable Unicode for LaTeX: narration, video captions and canvas text
// wherever KaTeX cannot run. A command reads as what it shows, never as its
// name.
export function texToText(tex) {
  return rows(readTex(String(tex ?? '')), ' ')
    .replace(/\u0001(?=[\p{Lu}\p{Ll}\p{Lo}\d])/gu, ' ')
    .replace(/[\u0001-\u0003]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .normalize('NFC')
}

// Narration with formulas turned into readable text and markup removed, so
// no voice reads out "$", "\\frac" or "**".
export function spokenText(value) {
  return parseInline(value).map(segment => (segment.kind === 'math' ? texToText(segment.tex) : segment.text)).join('')
}

const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '；', ';'])
const CLOSERS = new Set(['”', '’', '」', '』', '）', ')', '】', ']', '"', "'", '…'])

// Narration split into the sentences shown as captions and spoken one at a
// time. Formulas are never split, and closing quotes stay with their sentence.
export function captionSentences(value) {
  const source = String(value ?? '')
  const out = []
  let current = ''
  const flush = () => {
    const sentence = current.trim()
    if (sentence) out.push(sentence)
    current = ''
  }
  let last = 0
  const plain = textValue => {
    const chars = [...textValue]
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index]
      if (char === '\n') {
        flush()
        continue
      }
      current += char
      // An English full stop ends a sentence when a new one starts after it
      // (not in "3.14" or "e.g. this").
      const stop = char === '.' && (index + 1 === chars.length || (/\s/u.test(chars[index + 1]) && /[\p{Lu}\p{Lo}]/u.test(chars[index + 2] ?? '')))
      if (!SENTENCE_END.has(char) && !stop) continue
      while (index + 1 < chars.length && (SENTENCE_END.has(chars[index + 1]) || CLOSERS.has(chars[index + 1]))) current += chars[++index]
      flush()
    }
  }
  for (const match of source.matchAll(MATH)) {
    plain(source.slice(last, match.index))
    current += match[0]
    last = match.index + match[0].length
  }
  plain(source.slice(last))
  flush()
  return out
}
