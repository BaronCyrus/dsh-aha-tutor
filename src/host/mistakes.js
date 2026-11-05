// Each course's mistake book, kept beside its progress (see
// core/mistakes.js): answers to the course's questions go in as they are
// recorded, a check that fixes a question fixes its mistakes too, and the
// book is read for the course page and for review sessions.

import { conceptIndex, findLesson } from '../core/course-model.js'
import { answeredRight, fixMistakes, itemSig, listMistakes, noteAnswer } from '../core/mistakes.js'
import { TutorError } from './generate.js'

export function createMistakes({ store }) {
  const path = courseId => store.paths.mistakes(courseId)
  const itemsOf = value => (Array.isArray(value?.items) ? value.items : [])

  async function read(courseId) {
    return itemsOf(await store.readJson(path(courseId), null))
  }

  // Rewrite the book with change (book → the new book, or null when nothing
  // changes). Tried on the book as read first, so an answer that changes
  // nothing writes nothing.
  async function update(courseId, change) {
    if (!change(await read(courseId))) return false
    let changed = false
    await store.updateJson(path(courseId), null, value => {
      const next = change(itemsOf(value))
      changed = Boolean(next)
      return next ? { items: next } : { items: itemsOf(value) }
    })
    return changed
  }

  // An answer to a question its course keeps (see noteAnswer; sig: which
  // question the learner answered). stored(): the question where the course
  // keeps it, read only to start a mistake, or to tell which question it is
  // when the answer came without sig. An answer to a question the course
  // has written anew since is not taken for an answer to this one. Returns
  // whether the book took the answer.
  async function note(courseId, answer, stored) {
    let sig = typeof answer.sig === 'string' && answer.sig ? answer.sig : null
    const book = await read(courseId)
    const known = () => book.some(entry => entry.key === answer.key && entry.sig === sig)
    let item = null
    if (!sig || !known()) {
      if (sig && answeredRight(answer)) return false
      item = await stored().catch(() => null)
      if (!item) return false
      if (!sig) sig = itemSig(item)
      else if (itemSig(item) !== sig) return false
      if (answeredRight(answer) && !known()) return false
    }
    return update(courseId, current => noteAnswer(current, { ...answer, sig }, item))
  }

  // A check fixed a question, or graded answers to it again (see fixMistakes).
  async function fixed(courseId, change) {
    return update(courseId, current => fixMistakes(current, change))
  }

  // A question kept in the book (key and sig), for a check of it when the
  // course keeps another question in its place now, or none. save(change)
  // rewrites it there and returns it as saved. Null when not in the book.
  async function place(courseId, key, sig) {
    const entry = (await read(courseId)).find(item => item.key === key && item.sig === sig)
    if (!entry) return null
    const save = async change => {
      let saved = null
      await store.updateJson(path(courseId), null, value => {
        const items = itemsOf(value)
        const index = items.findIndex(item => item.key === key && item.sig === sig)
        if (index < 0) throw new TutorError('not-found', 'Not found')
        saved = change(items[index].item)
        items[index] = { ...items[index], item: saved, sig: itemSig(saved) }
        return { items }
      })
      return saved
    }
    return { item: entry.item, save }
  }

  // The mistakes whose question is still part of the course: its lesson,
  // its unit for a unit quiz question, its concept for a set on one.
  async function entries(course) {
    const concepts = conceptIndex(course)
    const inCourse = entry => (entry.source?.kind === 'quiz'
      ? Boolean(course.units?.some(unit => unit.id === entry.unitId))
      : entry.source?.kind === 'drill'
        ? concepts.has(entry.source.conceptId)
        : Boolean(entry.lessonId && findLesson(course, entry.lessonId)))
    return (await read(course.id)).filter(inCourse)
  }

  // The book as the course page lists it.
  async function list(course) {
    return listMistakes(await entries(course))
  }

  return Object.freeze({ read, note, fixed, place, entries, list })
}
