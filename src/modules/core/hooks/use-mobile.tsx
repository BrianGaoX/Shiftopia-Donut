import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Synchronous initializer so the first render already has the correct value.
// The previous lazy-effect pattern made every mount render the desktop layout
// for a frame, then swap to <DesktopOnlyScreen /> after the effect fired — a
// single >0.2 layout shift on mobile widths and the dominant CLS contributor
// on the rosters page.
function getIsMobile(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(getIsMobile)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
