// Visitors keep the landing page; an existing Otter browser login opens Mail.
// Local website development never touches a production account.
if (
  location.hostname === "mail.otterware.app" &&
  !new URL(location.href).searchParams.has("signed_out")
) {
  void fetch("https://accounts.otterware.app/otter/session", { credentials: "include" })
    .then(async (response) => {
      if (response.ok && (await response.json()).signedIn) location.replace("/app");
    })
    .catch(() => {});
}
