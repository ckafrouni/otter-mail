import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Linking, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";
import { useStackNavigation } from "../../lib/navigation";

/**
 * Sizes the page to its content and reports the height. Mail laid out wider
 * than the phone (600px newsletters) is zoomed down to fit instead of
 * scrolling sideways.
 */
const MEASURE_SCRIPT = `
  (function () {
    function report() {
      var body = document.body;
      body.style.zoom = 1;
      var wide = document.documentElement.scrollWidth;
      if (wide > window.innerWidth) body.style.zoom = window.innerWidth / wide;
      window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight));
    }
    new ResizeObserver(report).observe(document.body);
    window.addEventListener("load", report);
    report();
  })();
  true;
`;

function wrapHtml(html: string): string {
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; color: #27272a; }
  body { font: -apple-system-body; font-size: 15px; line-height: 1.45; padding: 14px 16px;
    overflow-wrap: anywhere; -webkit-text-size-adjust: 100%; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; }
  blockquote { margin: 0 0 0 8px; padding-left: 10px; border-left: 2px solid #d4d4d8; }
  a { color: #1b4ed8; }
</style></head><body>${html}</body></html>`;
}

/**
 * A message body: HTML in a WebView on a white card (mail is designed for
 * light backgrounds, in dark mode too), plain text natively. Links open in
 * Safari's sheet; mailto links open a new message here.
 */
export function MessageBody(props: { html: string | null; text: string | null }) {
  const navigation = useStackNavigation();
  const [height, setHeight] = useState(80);

  if (!props.html) {
    return (
      <Text selectable className="px-4 pb-4 text-base">
        {props.text?.trim() || " "}
      </Text>
    );
  }

  return (
    <View className="overflow-hidden rounded-2xl bg-white" style={{ height }}>
      <WebView
        originWhitelist={["*"]}
        source={{ html: wrapHtml(props.html) }}
        injectedJavaScript={MEASURE_SCRIPT}
        onMessage={(event) => {
          const next = Number(event.nativeEvent.data);
          if (next > 0) setHeight(Math.ceil(next));
        }}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        dataDetectorTypes={["phoneNumber", "link", "address", "calendarEvent"]}
        style={{ backgroundColor: "transparent" }}
        onShouldStartLoadWithRequest={(request) => {
          if (request.navigationType !== "click") return true;
          if (request.url.startsWith("mailto:")) {
            const to = decodeURIComponent(request.url.slice("mailto:".length).split("?")[0] ?? "");
            navigation.navigate("Compose", { mode: "new", to });
          } else if (/^https?:/i.test(request.url)) {
            void WebBrowser.openBrowserAsync(request.url);
          } else {
            void Linking.openURL(request.url).catch(() => undefined);
          }
          return false;
        }}
      />
    </View>
  );
}
