# Offline stage rehearsal

Prepare the laptop on a network with internet access. Install the locked frontend, backend, and ML environments using their component READMEs. Build the frontend locally. Prepare the ML models, synthetic seed, and projected population before disconnecting. The stage server reads the finished frontend from `frontend/dist`. All browser requests use the same origin.

## Phone connection

1. Select a private LAN or hotspot on which the laptop and both phones can communicate. Reserve the laptop address, for example `192.168.1.15`.
2. Issue a server certificate with the selected IP or local DNS name in its subject alternative names. A local CA tool such as mkcert can issue the certificate before the rehearsal. Keep the CA private key and the server key on the laptop. Install only the **public CA certificate** on the demo phones and enable trust. Store certificates outside the repository.
3. Start the private ML process on loopback port 8001. In the backend environment select `ML_MODE=live` and set the server-to-server ML token, analyst token, and account-specific Guardian tokens as described in the backend README. For a fixture rehearsal choose `ML_MODE=mock` explicitly.
4. From the repository root, using the interpreter with the backend dependencies installed, run the stage server.

```sh
python -m scripts.stage --bind 192.168.1.15 --origin https://192.168.1.15:8443 \
  --cert /path/to/stage-cert.pem --key /path/to/stage-key.pem
```

5. Open `/mobile` on the transfer phone, `/dashboard` on the projector laptop, and `/guardian` on the second phone at that HTTPS origin. Keep analyst and Guardian credentials with their intended operators. Confirm there are no certificate warnings. Grant requested motion access through the phone's activation button.
6. Disconnect internet access while keeping the local Wi-Fi link active. Reload each view. Check that assets render, sockets connect, and the phone reports an actual sampling rate or identifies unavailable motion.

## Prepare the owner baseline

In live mode, a new account starts with unavailable owner evidence. Have the verified owner perform three separate transfers with sensor coverage. In the dashboard open each eligible session, enter the analyst credential, and explicitly attest ownership. The original receipts remain unchanged. Use a subsequent transfer to demonstrate owner verification. A session with a hold, conflicting identity, or inadequate evidence is ineligible for enrollment.

## Three-minute demonstration

| Time | Presenter action | Evidence to inspect |
| --- | --- | --- |
| 0:00–0:30 | Complete a normal transfer with a verified demo owner. | Same session on phone and dashboard, measured waveform when available. |
| 0:30–1:00 | Target the active demo session with the protected synthetic interaction. | Browser provenance, actual motion coverage, and the resulting policy decision. |
| 1:00–1:45 | Have the second enrolled participant operate the first account, then a second demo account. | Owner similarity, linked account IDs, map, and evidence contributing to the decision. |
| 1:45–2:25 | Inspect a case, confirm a demo ban, and download its dossier. | Confirmed ban result and case identifiers consistent with the dashboard. |
| 2:25–3:00 | Open the Guardian alert on phone two and freeze the simulated transfer. | Delivery acknowledgement and idempotent state change on reconnect. |

## Reset and measurement

Use separate data directories for each rehearsal. Preserve the verified seed and weights as a read-only starting point. Stop both services before copying a prepared snapshot. Select a fresh SQLite path and a fresh copy of the prepared identity store for the next run. This preserves past rehearsals and avoids copying a live database.

Record device, OS/browser, measured sampling rate, missing-sensor behavior, tap coverage, detector time, end-to-end time, and each observed decision. Record real and synthetic results separately. For phone denial and ML outage, check the evidence labels and verify the phone never presents missing identity or motion as a verified success. Keep participant data, temporary recordings, tokens, private keys, databases, and builds outside version control.
