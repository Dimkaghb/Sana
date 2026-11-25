# Telemetry SDK - Person Two

Implementation starts in Step 3 of `../../../docs/IMPLEMENTATION_PLAN.md`.

Planned files: `kinetiq-sdk.ts`, `useKinetiq.ts`, collectors, bounded buffer, transport, and contract-aligned types. Keep the headless core independent of React.

Planned public capabilities: sensor activation, session/account reset, marked-input or custom-keypad timing, slider callbacks, submission of Contract A, consumption of Contract D, and cleanup. These are not existing exports.

Preserve `KinetiqSDK` and `data-kinetiq-field`. Do not fabricate absent contact, dwell, orientation, or motion measurements.
