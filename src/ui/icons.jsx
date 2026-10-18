// Line icons drawn for this plugin (24×24, currentColor).
const PATHS = {
  // The sidebar mark: a light bulb with three rays, matching icon.png.
  logo: 'M12 2v1.5M4.5 5l1.1 1.1M19.5 5l-1.1 1.1M9 18v-.6c0-.8-.4-1.5-1-2.1a5.5 5.5 0 1 1 8 0c-.6.6-1 1.3-1 2.1v.6zM9.5 21h5',
  home: 'M4 11l8-6.5 8 6.5V20h-5v-5h-6v5H4z',
  courses: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z',
  assist: 'M4 5h16v10H9l-5 4zM9 9.5h6M9 12h4',
  library: 'M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.6-.9 2.4 15.6-3.6.9z',
  studio: 'M5 19l4-1 10-10-3-3L6 15l-1 4zM14 6l3 3M4 21h16',
  shorts: 'M4 6h16v12H4zM10 9.5v5l4.5-2.5z',
  plan: 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M8.5 13h3M8.5 16h6',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1.5-2-3.5-2.3.7a7 7 0 0 0-1.7-1L14.5 4h-5l-.5 2.7a7 7 0 0 0-1.7 1L5 7 3 10.5 5 12l-2 1.5L5 17l2.3-.7a7 7 0 0 0 1.7 1l.5 2.7h5l.5-2.7a7 7 0 0 0 1.7-1L19 17l2-3.5z',
  board: 'M3 5h18v11H3zM8 20h8M12 16v4M7 9l3 3 2-2 4 3',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3',
  play: 'M7 5l12 7-12 7z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
}

export function Icon({ name, size = 18 }) {
  const path = PATHS[name] ?? PATHS.spark
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
}
