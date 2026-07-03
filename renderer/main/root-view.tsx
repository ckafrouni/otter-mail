import { Outlet } from "@tanstack/react-router";
import * as React from "react";
import { Status, injectActiveTheme } from "@glaze/core/components";
import { useConnection, useEnvironment } from "@glaze/core/hooks";
import { SLACK_DARK_THEME } from "./gmail/slack-theme";

// Force the Slack skin regardless of the system appearance. Replaces
// useTheme(): its prefers-color-scheme listener would strip the `dark` class
// on a light system, and its accent sync would let the macOS accent override
// the theme's.
injectActiveTheme(SLACK_DARK_THEME);

export function RootView() {
  // IPC connection and environment
  const connectionQuery = useConnection();
  const environmentQuery = useEnvironment();

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
      <div className="h-full">
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
