// Inline board text: **bold**, ==highlight==, $math$ and plain runs, with a
// visible length so text can be "written" a character at a time.

// A formula is one token wherever it stands, so "==" or "**" inside it never
// opens a style, and a bold or highlighted run may contain formulas.
const MATH = /\$[^$\n]+\$/gu
const TOKEN = /(\$[^$\n]+\$|\*\*(?:\$[^$\n]+\$|[^*\n])+?\*\*|==(?:\$[^$\n]+\$|[^=\n])+?==)/gu

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

const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' }
const SYMBOLS = { cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', infty: '∞', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftrightarrow: '⇔', sum: 'Σ', prod: 'Π', int: '∫', oint: '∮', partial: '∂', nabla: '∇', sqrt: '√', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', forall: '∀', exists: '∃', degree: '°', circ: '°', angle: '∠', perp: '⊥', parallel: '∥', ldots: '…', cdots: '⋯', dots: '…', propto: '∝', sim: '∼', hbar: 'ħ', ell: 'ℓ', quad: ' ', qquad: '  ' }
const SUPER = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', T: 'ᵀ' }
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', n: 'ₙ', x: 'ₓ', k: 'ₖ', t: 'ₜ' }

// Readable Unicode for common LaTeX, for canvas text.
// Readable Unicode for common LaTeX: canvas text, narration and captions
// wherever KaTeX cannot run.
export function texToText(tex) {
  let value = String(tex ?? '')
  for (let round = 0; round < 4; round += 1) {
    value = value.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/gu, (_, a, b) => `${a.length > 1 ? `(${a})` : a}/${b.length > 1 ? `(${b})` : b}`)
    value = value.replace(/\\sqrt\{([^{}]*)\}/gu, (_, a) => `√${a.length > 1 ? `(${a})` : a}`)
    value = value.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf)\{([^{}]*)\}/gu, '$1')
  }
  value = value.replace(/\\(left|right|big|Big|bigg|Bigg|displaystyle)\b/gu, '')
  value = value.replace(/\\([a-zA-Z]+)/gu, (match, word) => GREEK[word] ?? SYMBOLS[word] ?? word)
  value = value.replace(/\^\{([^{}]*)\}|\^(.)/gu, (_, group, single) => [...(group ?? single)].map(char => SUPER[char] ?? char).join(''))
  value = value.replace(/_\{([^{}]*)\}|_(.)/gu, (_, group, single) => [...(group ?? single)].map(char => SUB[char] ?? char).join(''))
  return value.replace(/\\[,;:! ]/gu, ' ').replace(/[{}]/gu, '').replace(/\s+/gu, ' ').trim()
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
