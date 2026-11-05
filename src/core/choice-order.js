// The order a question's options are shown in. A model tends to write the
// right option first, so the options of a question it wrote are put in an
// order of their own: by a hash of the question and each option's text,
// the same however often the same question is normalized (a board is
// normalized again as every step streams in). Options with an order of
// their own keep it: numbers run from small to large, true/false and
// yes/no stay in that order, and an option about the others ("all of the
// above") keeps its place. A question whose options or stem name options
// by letter is left as it is. Letters that name options in the
// explanation and hints follow their options.
//
// Only questions just written are reordered: answers to a kept question
// are logged by option id, so its order must never change afterwards.

const IDS = 'abcdefgh'

// Options that keep their place: one about the others ("all of the above",
// "none of these", 以上都对, 都不正确) and "cannot be determined".
const KEEPS_PLACE = /以上|上述|前述|其余选项|(?:^|[\s,，])(?:都|均|全)(?:不|没有?)?(?:对|正确|错误?|是|成立|可以|符合)|\babove\b|\b(?:all|none|neither|both) of (?:these|them|the options)\b|^(?:all|none|neither|both)\b|无法(?:判断|确定)|不能确定|cannot be determined|can't be determined|not enough information/iu

// Two options that say yes and no to the same thing, the yes first.
const TRUTH_PAIRS = [['正确', '错误'], ['对', '错'], ['是', '否'], ['true', 'false'], ['yes', 'no'], ['√', '×'], ['✓', '✗']]

const LETTER_LIST = '[A-H](?:\\s*(?:、|,|，|和|与|及|或|/|and|or)\\s*[A-H])*'
// A letter that names an option: after 选项, 选, 答案是, "option", "the
// answer is", or before 项, 选项, 正确, 错误. A bare letter may be a point, a
// force or a variable, so it is never touched.
const LETTER_AFTER = new RegExp(`(选项|选(?!择)|答案(?:是|为|应为|应是|应选|选)?\\s*[:：]?|\\b(?:[Tt]he\\s+)?(?:[Oo]ptions?|[Cc]hoices?|[Aa]nswers?)(?:\\s+(?:is|are))?\\s*[:：]?)(\\s*[(（]?)(${LETTER_LIST})(?![A-Za-z0-9])`, 'gu')
const LETTER_BEFORE = new RegExp(`(?<![A-Za-z0-9])(${LETTER_LIST})(\\s*)(选项|项(?!目)|(?:是|为)?(?:正确|错误|不正确))`, 'gu')

// An option that names other options ("A 和 C 都对", "both A and B"), or is
// a letter itself (objects A and B of the stem), which would read as
// another option once moved.
function namesOptions(textValue) {
  return /^\s*[(（]?[A-H][)）]?\s*$/u.test(textValue)
    || /(?:选项|option|choice)\s*[A-H](?![A-Za-z0-9])/iu.test(textValue)
    || /(?<![A-Za-z0-9])[A-H]\s*(?:项(?!目)|选项)/u.test(textValue)
    || /(?<![A-Za-z0-9])[A-H]\s*(?:和|与|及|、|,|，|or|and|&)\s*[A-H](?![A-Za-z0-9])/u.test(textValue)
}

// A stem that still lists lettered options ("…？ A. … B. …").
function listsOptions(prompt) {
  return /(?:^|[\s(（:：？?。])[(（]?A[)）.．、:：]\s*\S[\s\S]*?(?:^|[\s(（;；,，。])[(（]?B[)）.．、:：]\s*\S/mu.test(prompt)
}

function hash(value) {
  let h = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function hashOrder(item, indexes) {
  const keys = new Map(indexes.map(index => [index, hash(`${item.prompt}\u0001${item.options[index].text}`)]))
  return [...indexes].sort((a, b) => keys.get(a) - keys.get(b) || a - b)
}

const plain = value => String(value ?? '').replace(/\$/gu, '').replace(/\s+/gu, ' ').trim()

// "3 cm", "约 9%", "1/3", "-2.5 m/s" → { value, unit }; null when the text is
// not a number with at most a unit after it.
function numberOf(textValue) {
  const match = /^(约|大约|约为|≈|~|about|approximately)?\s*([+\-−]?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(.*)$/iu.exec(plain(textValue))
  if (!match) return null
  const value = Number(match[2].replace('−', '-')) / (match[3] ? Number(match[3]) : 1)
  const unit = match[4].trim()
  if (!Number.isFinite(value) || unit.length > 12 || /\d/u.test(unit)) return null
  return { value, unit: `${(match[1] ?? '').toLowerCase()}|${unit}` }
}

// The order options already have (a permutation of indexes), or null.
function naturalOrder(texts) {
  if (texts.length === 2) {
    const words = texts.map(value => plain(value).toLowerCase().replace(/[。.!！]$/u, ''))
    for (const pair of TRUTH_PAIRS) {
      if (words[0] === pair[0] && words[1] === pair[1]) return [0, 1]
      if (words[0] === pair[1] && words[1] === pair[0]) return [1, 0]
    }
    // "能 / 不能", "成立 / 不成立"
    if (words[1] === `不${words[0]}` || words[1] === `没${words[0]}`) return [0, 1]
    if (words[0] === `不${words[1]}` || words[0] === `没${words[1]}`) return [1, 0]
  }
  const numbers = texts.map(numberOf)
  if (texts.length >= 2 && numbers.every(Boolean) && numbers.every(entry => entry.unit === numbers[0].unit)) {
    return numbers.map((entry, index) => index).sort((a, b) => numbers[a].value - numbers[b].value || a - b)
  }
  return null
}

function choiceOrder(item) {
  const indexes = item.options.map((_, index) => index)
  const pinned = new Set(indexes.filter(index => KEEPS_PLACE.test(item.options[index].text)))
  const free = indexes.filter(index => !pinned.has(index))
  const natural = naturalOrder(free.map(index => item.options[index].text))
  const arranged = natural ? natural.map(position => free[position]) : hashOrder(item, free)
  let next = 0
  return indexes.map(index => (pinned.has(index) ? index : arranged[next++]))
}

// The steps of an order question never start in their solved order.
function stepOrder(item) {
  const order = hashOrder(item, item.options.map((_, index) => index))
  const shown = order.map(index => item.options[index].id)
  if (shown.length > 1 && shown.every((id, index) => id === item.answer[index])) order.push(order.shift())
  return order
}

function relabel(textValue, letters) {
  if (!textValue) return textValue
  const swap = list => list.replace(/[A-H]/gu, letter => letters.get(letter) ?? letter)
  return textValue
    .replace(LETTER_AFTER, (_, before, gap, list) => `${before}${gap}${swap(list)}`)
    .replace(LETTER_BEFORE, (_, list, gap, after) => `${swap(list)}${gap}${after}`)
}

// The question with its options in their shown order (the same object when
// nothing moves).
export function orderOptions(item) {
  if (!item || !['choice', 'multi', 'order'].includes(item.kind) || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > IDS.length) return item
  if (item.options.some(option => namesOptions(option.text))) return item
  if (item.kind !== 'order' && listsOptions(item.prompt)) return item
  const order = item.kind === 'order' ? stepOrder(item) : choiceOrder(item)
  if (order.every((from, to) => from === to)) return item
  const ids = new Map(order.map((from, to) => [item.options[from].id, IDS[to]]))
  const letters = new Map([...ids].map(([from, to]) => [from.toUpperCase(), to.toUpperCase()]))
  const next = { ...item, options: order.map((from, to) => ({ ...item.options[from], id: IDS[to] })) }
  if (item.kind === 'choice') next.answer = ids.get(item.answer) ?? item.answer
  else if (item.kind === 'multi') next.answer = item.answer.map(id => ids.get(id) ?? id).sort()
  else next.answer = item.answer.map(id => ids.get(id) ?? id)
  if (item.explanation) next.explanation = relabel(item.explanation, letters)
  if (Array.isArray(item.hints)) next.hints = item.hints.map(hint => relabel(hint, letters))
  return next
}

// Every step check of a board just written.
export function orderBoardOptions(board) {
  if (!board?.steps?.some(step => step.check)) return board
  return { ...board, steps: board.steps.map(step => (step.check ? { ...step, check: orderOptions(step.check) } : step)) }
}
