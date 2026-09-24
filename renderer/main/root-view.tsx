import { Outlet } from "@tanstack/react-router";
import * as React from "react";
import { Status } from "@glaze/core/components";
import { useConnection, useEnvironment } from "@glaze/core/hooks";
import { applyAppTheme, startAppTheme } from "./theme/apply-theme";

// Color theme (Settings → Appearance) for the current appearance, applied
// before first paint. Replaces useTheme(): its accent sync would let the macOS
// accent override the theme's, and the theme injection owns the `dark` class.
applyAppTheme();

export function RootView() {
  // IPC connection and environment
  const connectionQuery = useConnection();
  const environmentQuery = useEnvironment();

  // Re-theme live on appearance switches and theme picks from any window.
  React.useEffect(() => startAppTheme(), []);

  // Cleanup IPC connection on unmount
  React.useEffect(() => {
    return () => {
      console.log("[RootView] cleanup - disconnecting IPC client");
      window.glazeAPI?.glaze?.ipc?.disconnect();
    };
  }, []);

  return (
    <div className="h-full relative [&:not(:has([data-toolbar]))_.drag-region]:z-50">
      {/* Draggable top bar - fallback for when no toolbar is present */}
      <div className="drag-region fixed top-0 left-0 right-0 h-13" />
      {/* relative: paints above the fixed fallback strip, which otherwise
          swallows clicks on the app's own top bar (the strip still wins via
          z-50 when no [data-toolbar] is mounted). */}
      <div className="relative h-full">
        <Outlet />
      </div>

      <div className="flex flex-col items-end gap-1 mt-2 fixed bottom-12 right-2">
        {import.meta.env.DEV ? (
          <>
            {connectionQuery.error ? <Status variant="error">Backend disconnected</Status> : null}
            {environmentQuery.data ? null : <Status variant="error">Dev Server not found</Status>}
          </>
        ) : null}
      </div>
    </div>
  );
}
