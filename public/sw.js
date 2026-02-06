self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    console.error("[sw] failed to parse push payload");
    return;
  }

  const tag = `zane-${data.type}-${data.threadId || "global"}`;

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag,
      data: { actionUrl: data.actionUrl || "/app" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const actionUrl = event.notification.data?.actionUrl || "/app";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (new URL(client.url).origin === self.location.origin) {
            client.focus();
            client.postMessage({ type: "navigate", url: actionUrl });
            return;
          }
        }
        return self.clients.openWindow(actionUrl);
      })
  );
});
