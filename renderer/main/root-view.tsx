import { Outlet } from "@tanstack/react-router";
import * as React from "react";
import { Status, injectActiveTheme } from "@glaze/core/components";
import { useConnection, useEnvironment } from "@glaze/core/hooks";
import { SLACK_DARK_THEME, SLACK_LIGHT_THEME } from "./gmail/slack-theme";

// Follow the system appearance with the matching Slack skin. Replaces
// useTheme(): its accent sync would let the macOS accent override the
// theme's, and the theme injection owns the `dark` class instead.
function applySlackTheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  injectActiveTheme(dark ? SLACK_DARK_THEME : SLACK_LIGHT_THEME);
}
applySlackTheme();

export function RootView() {
  // IPC connection and environment
  const connectionQuery = useConnection();
  const environmentQuery = useEnvironment();

  // Re-skin live when macOS switches appearance (auto light/dark).
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applySlackTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
