import { useCallback, useEffect, useRef, useState } from 'react'

import { CrashNotice, ErrorBoundary } from './boundary.js'
import { forgetRoute, ROUTE_EVENT, useAppValue, useRoute } from './context.js'
import { AppContext } from './hooks.js'
import { Icon } from './icons.jsx'
import { AboutScreen } from './screens/About.jsx'
import { AssistScreen } from './screens/Assist.jsx'
import { CourseScreen } from './screens/Course.jsx'
import { CoursesScreen } from './screens/Courses.jsx'
import { CraftScreen } from './screens/Craft.jsx'
import { HandoutScreen } from './screens/Handout.jsx'
import { HomeScreen } from './screens/Home.jsx'
import { LessonScreen } from './screens/Lesson.jsx'
import { MaterialsScreen } from './screens/Materials.jsx'
import { PlanScreen } from './screens/Plan.jsx'
import { ProfileScreen } from './screens/Profile.jsx'
import { ProjectScreen } from './screens/Project.jsx'
import { SettingsScreen } from './screens/Settings.jsx'
import { ShortsScreen } from './screens/Shorts.jsx'
import { StudioScreen } from './screens/Studio.jsx'
import { CardsScreen, ItemScreen, PracticeScreen, SheetScreen } from './screens/Study.jsx'

const NAV = [
  ['home', 'navHome', 'home'],
  ['courses', 'navCourses', 'courses'],
  ['assist', 'navAssist', 'assist'],
  ['materials', 'navMaterials', 'library'],
  ['studio', 'navStudio', 'studio'],
  ['shorts', 'navShorts', 'shorts'],
  ['plan', 'navPlan', 'plan'],
  ['profile', 'navProfile', 'profile'],
  ['settings', 'navSettings', 'settings'],
  ['about', 'navAbout', 'heart'],
]

const SCREENS = {
  home: HomeScreen,
  courses: CoursesScreen,
  craft: CraftScreen,
  handout: HandoutScreen,
  course: CourseScreen,
  lesson: LessonScreen,
  practice: PracticeScreen,
  cards: CardsScreen,
  sheet: SheetScreen,
  item: ItemScreen,
  project: ProjectScreen,
  materials: MaterialsScreen,
  studio: StudioScreen,
  assist: AssistScreen,
  shorts: ShortsScreen,
  plan: PlanScreen,
  profile: ProfileScreen,
  settings: SettingsScreen,
  about: AboutScreen,
}

const ROOT_OF = { craft: 'courses', course: 'courses', lesson: 'courses', handout: 'courses', practice: 'courses', project: 'courses', cards: 'studio', sheet: 'studio', item: 'studio' }

// A screen that crashes is replaced by a notice while the navigation keeps
// working. A crash anywhere else replaces the whole page, and only a fresh
// start from the home page is offered.
export function App(props) {
  const [restarts, setRestarts] = useState(0)
  return <ErrorBoundary key={restarts} onError={forgetRoute} fallback={({ error }) => <div className="aha">
    <main className="aha-main"><CrashNotice t={props.t} error={error} onHome={() => setRestarts(value => value + 1)} /></main>
  </div>}>
    <Page {...props} />
  </ErrorBoundary>
}

function Page({ rpc, t, language, dsh }) {
  const { route, setRoute, crashed } = useRoute()
  const history = useRef([])

  const navigate = useCallback((screen, params = {}, { replace = false } = {}) => {
    setRoute(current => {
      if (!replace) {
        history.current.push(current)
        if (history.current.length > 40) history.current.shift()
      }
      return { screen, params }
    })
  }, [setRoute])
  const back = useCallback(() => {
    const previous = history.current.pop()
    setRoute(previous ?? { screen: 'home', params: {} })
  }, [setRoute])

  // Conversation cards ask the page to show a screen.
  useEffect(() => {
    const onRoute = event => {
      const next = event.detail
      if (next?.screen && SCREENS[next.screen]) navigate(next.screen, next.params ?? {})
    }
    window.addEventListener(ROUTE_EVENT, onRoute)
    return () => window.removeEventListener(ROUTE_EVENT, onRoute)
  }, [navigate])

  const { value, toastText } = useAppValue({ rpc, t, language, dsh, navigate, back })
  const Screen = SCREENS[route.screen] ?? HomeScreen
  const activeRoot = ROOT_OF[route.screen] ?? route.screen
  // Opening a screen starts a new history. Opening the one on show again
  // retries it after a crash, since every route object is new.
  const open = screen => { history.current = []; setRoute({ screen, params: {} }) }

  return <AppContext.Provider value={value}>
    <div className="aha">
      <nav className="aha-nav">
        <div className="aha-brand"><Icon name="logo" size={24} /><span>{t('appName')}<small>{t('appTagline')}</small></span></div>
        {NAV.map(([screen, label, icon]) => <button key={screen} type="button" className="aha-navItem" data-active={activeRoot === screen} onClick={() => open(screen)} title={t(label)}>
          <Icon name={icon} size={17} /><span>{t(label)}</span>
        </button>)}
      </nav>
      <main className="aha-main">
        <ErrorBoundary resetKey={route} onError={crashed} fallback={({ error }) => <CrashNotice t={t} error={error} onRetry={() => setRoute(current => ({ ...current }))} onHome={() => open('home')} />}>
          <Screen key={`${route.screen}:${JSON.stringify(route.params)}`} {...route.params} />
        </ErrorBoundary>
      </main>
      {toastText ? <div className="aha-toast" role="status">{toastText}</div> : null}
    </div>
  </AppContext.Provider>
}
