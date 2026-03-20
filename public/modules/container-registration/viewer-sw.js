self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};

    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = {
        title: "Container Status",
        body: event.data ? event.data.text() : ""
      };
    }

    const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const hasVisibleClient = windowClients.some((client) => client.visibilityState === "visible");
    if (hasVisibleClient) return;

    const title = String(payload.title || "Container Status");
    const options = {
      body: String(payload.body || ""),
      tag: String(payload.tag || "container-registration"),
      renotify: true,
      requireInteraction: true,
      icon: String(payload.icon || "/container-registration/logo.png"),
      badge: String(payload.badge || "/container-registration/logo.png"),
      data: payload.data && typeof payload.data === "object" ? payload.data : {}
    };

    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const defaultTargetUrl = new URL("viewer.html", self.registration.scope).toString();
  const targetUrl = String(event.notification.data?.url || defaultTargetUrl);

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const matchingClient = windowClients.find((client) => "focus" in client && client.url.startsWith(self.location.origin));

    if (matchingClient) {
      await matchingClient.focus();
      if ("navigate" in matchingClient) {
        return matchingClient.navigate(targetUrl);
      }
      return matchingClient;
    }

    if (clients.openWindow) {
      return clients.openWindow(targetUrl);
    }

    return undefined;
  })());
});
