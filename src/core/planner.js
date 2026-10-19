// Study planning: lay out the remaining lessons of every active course over
// the learner's study days, keep a slice of each day for due reviews, and say
// whether each course's deadline is still reachable at the current pace.
// Pure functions over plain data; dates are local calendar days (YYYY-MM-DD).

const DAY_MS = 24 * 60 * 60 * 1000
const HORIZON_DAYS = 400
const REVIEW_SHARE = 0.3

export function toDay(date) {
  const value = date instanceof Date ? date : new Date(date)
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(day))
  if (!match) throw new TypeError(`invalid day "${day}"`)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function addDays(day, count) {
  const date = parseDay(day)
  date.setDate(date.getDate() + count)
  return toDay(date)
}

export function daysBetween(fromDay, toDayValue) {
  return Math.round((parseDay(toDayValue) - parseDay(fromDay)) / DAY_MS)
}

function normalizeSettings(settings = {}) {
  const studyDays = Array.isArray(settings.studyDays) && settings.studyDays.length
    ? [...new Set(settings.studyDays.map(Number).filter(day => day >= 0 && day <= 6))]
    : [1, 2, 3, 4, 5, 6, 0]
  const weeklyMinutes = clampNumber(settings.weeklyMinutes, 30, 6000, 300)
  const dailyMinutes = Math.max(15, Math.round(weeklyMinutes / studyDays.length))
  return { studyDays, weeklyMinutes, dailyMinutes }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

// courses: [{ id, title, deadline?, priority?, lessons: [{ id, title, minutes, done }] }]
// reviews: [{ id, courseId?, title, dueDay, minutes }]
// exams:   [{ id, title, day, courseId? }]
export function buildPlan({ today, settings, courses = [], reviews = [], exams = [] }) {
  const start = today ?? toDay(new Date())
  const { studyDays, weeklyMinutes, dailyMinutes } = normalizeSettings(settings)

  const queues = courses
    .map(course => ({
      id: course.id,
      title: course.title,
      emoji: course.emoji || '',
      deadline: course.deadline || null,
      priority: Number(course.priority) || 0,
      remaining: (course.lessons || []).filter(lesson => !lesson.done).map(lesson => ({
        id: lesson.id,
        title: lesson.title,
        minutes: clampNumber(lesson.minutes, 5, 240, 20),
      })),
      finishDay: null,
    }))
    .filter(queue => queue.remaining.length > 0)

  const pendingReviews = [...reviews]
    .map(item => ({ ...item, minutes: clampNumber(item.minutes, 2, 60, 5), dueDay: item.dueDay || start }))
    .sort((a, b) => a.dueDay.localeCompare(b.dueDay))

  const days = []
  let rotation = 0
  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const day = addDays(start, offset)
    const weekday = parseDay(day).getDay()
    const examsToday = exams.filter(exam => exam.day === day)
    const items = examsToday.map(exam => ({ kind: 'exam', refId: exam.id, courseId: exam.courseId ?? null, title: exam.title, minutes: 0 }))

    if (studyDays.includes(weekday)) {
      let budget = dailyMinutes
      const reviewBudget = Math.round(dailyMinutes * REVIEW_SHARE)
      let reviewUsed = 0
      while (pendingReviews.length && pendingReviews[0].dueDay <= day && reviewUsed + pendingReviews[0].minutes <= reviewBudget) {
        const review = pendingReviews.shift()
        reviewUsed += review.minutes
        items.push({ kind: 'review', refId: review.id, courseId: review.courseId ?? null, title: review.title, minutes: review.minutes })
      }
      budget -= reviewUsed

      const ordered = orderQueues(queues, day, rotation)
      rotation += 1
      let placed = true
      while (budget > 0 && placed) {
        placed = false
        for (const queue of ordered) {
          const lesson = queue.remaining[0]
          if (!lesson) continue
          const dayIsEmpty = !items.some(item => item.kind === 'lesson')
          if (lesson.minutes <= budget || dayIsEmpty) {
            queue.remaining.shift()
            budget -= lesson.minutes
            items.push({ kind: 'lesson', refId: lesson.id, courseId: queue.id, title: lesson.title, courseTitle: queue.title, courseEmoji: queue.emoji, minutes: lesson.minutes })
            if (queue.remaining.length === 0) queue.finishDay = day
            placed = true
            break
          }
        }
      }
    }

    if (items.length) days.push({ day, items, minutes: items.reduce((sum, item) => sum + item.minutes, 0) })
    const lessonsLeft = queues.some(queue => queue.remaining.length)
    if (!lessonsLeft && !pendingReviews.length && !exams.some(exam => exam.day > day)) break
  }

  const warnings = []
  const courseSummaries = queues.map(queue => {
    const summary = { courseId: queue.id, finishDay: queue.finishDay, deadline: queue.deadline, onTrack: true }
    if (queue.remaining.length) {
      summary.onTrack = false
      warnings.push({ kind: 'beyond-horizon', courseId: queue.id })
    } else if (queue.deadline && queue.finishDay && queue.finishDay > queue.deadline) {
      summary.onTrack = false
      summary.neededWeeklyMinutes = neededWeeklyMinutes(courses.find(course => course.id === queue.id), start, queue.deadline, studyDays)
      warnings.push({ kind: 'deadline-at-risk', courseId: queue.id, finishDay: queue.finishDay, deadline: queue.deadline, neededWeeklyMinutes: summary.neededWeeklyMinutes })
    }
    return summary
  })

  return { start, weeklyMinutes, dailyMinutes, studyDays, days, courses: courseSummaries, warnings }
}

// Deadlines first, then explicit priority, then fair rotation.
function orderQueues(queues, day, rotation) {
  const active = queues.filter(queue => queue.remaining.length)
  if (!active.length) return []
  const rotated = active.map((queue, index) => ({ queue, turn: (index - rotation + active.length * 1000) % active.length }))
  return rotated
    .sort((a, b) => {
      const da = a.queue.deadline ?? '9999-12-31'
      const db = b.queue.deadline ?? '9999-12-31'
      if (da !== db) return da.localeCompare(db)
      if (a.queue.priority !== b.queue.priority) return b.queue.priority - a.queue.priority
      return a.turn - b.turn
    })
    .map(entry => entry.queue)
}

function neededWeeklyMinutes(course, start, deadline, studyDays) {
  const remaining = (course?.lessons || []).filter(lesson => !lesson.done).reduce((sum, lesson) => sum + clampNumber(lesson.minutes, 5, 240, 20), 0)
  const span = Math.max(1, daysBetween(start, deadline) + 1)
  let studyDayCount = 0
  for (let offset = 0; offset < span; offset += 1) {
    if (studyDays.includes(parseDay(addDays(start, offset)).getDay())) studyDayCount += 1
  }
  if (!studyDayCount) return null
  const perDay = remaining / studyDayCount / (1 - REVIEW_SHARE)
  return Math.ceil((perDay * studyDays.length) / 10) * 10
}

export function todayItems(plan, day) {
  return plan?.days?.find(entry => entry.day === day)?.items ?? []
}
