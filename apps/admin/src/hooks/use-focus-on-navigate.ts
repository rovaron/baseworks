import { useLocation } from "react-router";
import { useEffect, useRef } from "react";

export function useFocusOnNavigate() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const mainContent = document.getElementById("main-content");
    if (mainContent) {
      mainContent.setAttribute("tabindex", "-1");
      mainContent.focus({ preventScroll: false });
    }
  }, [location.pathname]);
}
