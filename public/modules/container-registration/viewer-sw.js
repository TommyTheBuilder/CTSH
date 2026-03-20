self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = String(event.notification.data?.url || "/container-registration/viewer.html");

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
