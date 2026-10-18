// Models wrap JSON in prose or code fences, cut it off at the token limit, or
// leave trailing commas. These helpers recover the structure when possible
// and say clearly when they cannot.

export class JsonExtractError extends Error {
  constructor(message, { cause, text } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'JsonExtractError'
    this.preview = typeof text === 'string' ? text.slice(0, 200) : undefined
  }
}

const FENCE = /```(?:json|jsonl|javascript|js)?\s*\n?([\s\S]*?)```/giu

function stripTrailingCommas(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === ',') {
      let next = index + 1
      while (next < text.length && /\s/u.test(text[next])) next += 1
      if (text[next] === '}' || text[next] === ']') continue
    }
    out += char
  }
  return out
}

// Find the first balanced {...} or [...] starting at or after `from`.
function balancedSlice(text, from = 0) {
  const start = text.slice(from).search(/[{[]/u)
  if (start < 0) return undefined
  const begin = from + start
  const stack = []
  let inString = false
  let escaped = false
  for (let index = begin; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      const open = stack.pop()
      if ((char === '}' && open !== '{') || (char === ']' && open !== '[')) return undefined
      if (stack.length === 0) return { begin, end: index + 1, text: text.slice(begin, index + 1) }
    }
  }
  return { begin, end: text.length, text: text.slice(begin), truncated: true, stack }
}

// Close an object/array cut off by the token limit: drop the dangling
// partial member, then close every open bracket.
export function repairTruncated(text) {
  let body = text
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const closed = closeOpen(body)
    if (closed !== undefined) {
      try {
        return JSON.parse(stripTrailingCommas(closed))
      } catch {
        // fall through and trim further
      }
    }
    const cut = Math.max(body.lastIndexOf(','), body.lastIndexOf('{'), body.lastIndexOf('['))
    if (cut <= 0) break
    body = body.slice(0, body[cut] === ',' ? cut : cut + 1)
  }
  throw new JsonExtractError('model output was truncated beyond repair', { text })
}

function closeOpen(text) {
  const stack = []
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') stack.pop()
  }
  if (inString) return undefined
  return text + stack.reverse().map(open => (open === '{' ? '}' : ']')).join('')
}

export function extractJson(raw, { allowTruncated = true } = {}) {
  if (raw !== null && typeof raw === 'object') return raw
  const text = String(raw ?? '').replace(/^﻿/u, '').trim()
  if (!text) throw new JsonExtractError('model returned an empty response', { text })

  const candidates = []
  for (const match of text.matchAll(FENCE)) candidates.push(match[1].trim())
  candidates.push(text)

  let lastError
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch (error) {
      lastError = error
    }
    const slice = balancedSlice(candidate)
    if (slice === undefined) continue
    if (!slice.truncated) {
      try {
        return JSON.parse(stripTrailingCommas(slice.text))
      } catch (error) {
        lastError = error
      }
    } else if (allowTruncated) {
      try {
        return repairTruncated(slice.text)
      } catch (error) {
        lastError = error
      }
    }
  }
  throw new JsonExtractError('model output did not contain valid JSON', { cause: lastError, text })
}

// JSON Lines: one object per line. Lines that fail to parse are reported so a
// streaming consumer can keep the good ones. `final` marks the end of the
// stream, so a last line without a newline still counts.
export function parseJsonLines(raw, { final = true } = {}) {
  const text = String(raw ?? '').replace(/```(?:jsonl|json)?/giu, '')
  const lines = text.split(/\r?\n/u)
  const rest = final ? '' : lines.pop() ?? ''
  const items = []
  const errors = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !/^[{[]/u.test(trimmed)) continue
    try {
      items.push(JSON.parse(stripTrailingCommas(trimmed)))
    } catch (error) {
      errors.push({ line: trimmed.slice(0, 120), message: error.message })
    }
  }
  return { items, errors, rest }
}
