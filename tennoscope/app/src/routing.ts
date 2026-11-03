export type AppRouteName = 'main' | 'overlay' | 'kiosk' | 'riven'

export function routeForPath(pathname: string): AppRouteName {
  if (pathname === '/overlay') return 'overlay'
  if (pathname === '/kiosk') return 'kiosk'
  if (pathname === '/riven') return 'riven'
  return 'main'
}
