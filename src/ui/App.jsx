import { useCallback, useEffect, useRef } from 'react'

import { ROUTE_EVENT, useAppValue } from './context.js'
import { AppContext, usePersistentState } from './hooks.js'
import { Icon } from './icons.jsx'
import { AssistScreen } from './screens/Assist.jsx'
import { CourseScreen } from './screens/Course.jsx'
import { CoursesScreen } from './screens/Courses.jsx'
import { CraftScreen } from './screens/Craft.jsx'
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
]

const SCREENS = {
  home: HomeScreen,
  courses: CoursesScreen,
  craft: CraftScreen,
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
}

const ROOT_OF = { craft: 'courses', course: 'courses', lesson: 'courses', practice: 'courses', project: 'courses', cards: 'studio', sheet: 'studio', item: 'studio' }

export function App({ rpc, t, language, dsh }) {
  const [route, setRoute] = usePersistentState('route', { screen: 'home', params: {} })
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

  return <AppContext.Provider value={value}>
    <div className="aha">
      <nav className="aha-nav">
        <div className="aha-brand"><Icon name="logo" size={24} /><span>{t('appName')}<small>{t('appTagline')}</small></span></div>
        {NAV.map(([screen, label, icon]) => <button key={screen} type="button" className="aha-navItem" data-active={activeRoot === screen} onClick={() => { history.current = []; setRoute({ screen, params: {} }) }} title={t(label)}>
          <Icon name={icon} size={17} /><span>{t(label)}</span>
        </button>)}
      </nav>
      <main className="aha-main">
        <Screen key={`${route.screen}:${JSON.stringify(route.params)}`} {...route.params} />
      </main>
      {toastText ? <div className="aha-toast" role="status">{toastText}</div> : null}
    </div>
  </AppContext.Provider>
}
