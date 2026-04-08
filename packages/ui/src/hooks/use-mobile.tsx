import * as React from "react"

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

type Breakpoint = "mobile" | "tablet" | "desktop"

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = React.useState<Breakpoint | undefined>(
    undefined
  )

  React.useEffect(() => {
    const mqlMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const mqlTablet = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT - 1}px)`)

    const update = () => {
      const width = window.innerWidth
      if (width < MOBILE_BREAKPOINT) {
        setBreakpoint("mobile")
      } else if (width < TABLET_BREAKPOINT) {
        setBreakpoint("tablet")
      } else {
        setBreakpoint("desktop")
      }
    }

    mqlMobile.addEventListener("change", update)
    mqlTablet.addEventListener("change", update)
    update()

    return () => {
      mqlMobile.removeEventListener("change", update)
      mqlTablet.removeEventListener("change", update)
    }
  }, [])

  return breakpoint ?? "desktop"
}

export function useIsMobile(): boolean {
  return useBreakpoint() === "mobile"
}
