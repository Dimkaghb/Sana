import { useEffect, useState } from "react";
import { Button } from "./ui/button";

async function deviceAction(token: string, action: string, endpoint: string) {
  const response = await fetch("/api/v1/guardian/device/" + action, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new Error("Device registration failed.");
  return (await response.json()).enabled as boolean;
}

export function GuardianDeviceAlerts({ token }: { token: string }) {
  const supported =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(supported);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    if (supported)
      void (async () => {
        const reg = await navigator.serviceWorker.getRegistration("/guardian");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          const state = await deviceAction(token, "status", sub.endpoint);
          if (active) setEnabled(state);
        }
      })()
        .catch(() => {
          if (active) setNotice("Device subscription status is unavailable.");
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    return () => {
      active = false;
    };
  }, [token, supported]);

  async function toggle() {
    setBusy(true);
    setNotice("");
    try {
      if (!enabled && (await Notification.requestPermission()) !== "granted") {
        setNotice("Notifications are off. Urgent transfers still appear here.");
        return;
      }
      await navigator.serviceWorker.register("/guardian-worker.js", {
        scope: "/guardian",
      });
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (enabled) {
        if (sub) {
          await deviceAction(token, "disable", sub.endpoint);
          await sub.unsubscribe();
        }
        setEnabled(false);
      } else {
        const res = await fetch("/api/v1/guardian/push-key", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!res.ok) throw new Error();
        const { public_key } = await res.json();
        const raw = atob(public_key.replace(/-/g, "+").replace(/_/g, "/"));
        const key = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
        const subscribedKey = sub?.options.applicationServerKey;
        if (
          sub &&
          subscribedKey &&
          !key.every((value, i) => value === new Uint8Array(subscribedKey)[i])
        ) {
          await sub.unsubscribe();
          sub = null;
        }
        const subscription =
          sub ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          }));
        try {
          await deviceAction(token, "enable", subscription.endpoint);
        } catch (error) {
          if (!sub) await subscription.unsubscribe();
          throw error;
        }
        setEnabled(true);
      }
    } catch {
      setNotice(
        "Could not update device alerts. Check notification settings and the connection, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!supported)
    return (
      <p>Keep Guardian open to receive urgent transfers on this browser.</p>
    );
  return (
    <div className="guardian-device">
      <Button type="button" disabled={busy} onClick={() => void toggle()}>
        {enabled ? "Disable device alerts" : "Enable device alerts"}
      </Button>
      <small>
        {enabled
          ? "Alerts stay on after closing Guardian or signing out."
          : "Receive an urgent notification on this device when Guardian is closed."}
      </small>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
