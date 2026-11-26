// The push service delivers an empty wake-up. Case details require Guardian access.
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("SANA Guardian", {
      body: "An urgent transfer needs your attention. Open Guardian.",
      icon: "/shield.svg",
      tag: "sana-guardian-urgent",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const guardian = windows.find((client) => {
        const url = new URL(client.url);
        return (
          url.origin === self.location.origin &&
          url.pathname === "/guardian" &&
          !url.search
        );
      });
      if (guardian) await guardian.focus();
      else await self.clients.openWindow("/guardian");
    })(),
  );
});
