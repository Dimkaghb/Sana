# SANA Shield project summary

We built a working local prototype that follows a simulated bank transfer from the customer’s first tap to an analyst’s review. The software runs end to end. Its ability to recognize people reliably on real phones still needs measurement.

## The transfer experience

1. We built a mobile banking demo, an analyst dashboard, and an account-specific Guardian view.
2. A customer signs in with a fictional account and activates protection for a transfer.
3. The customer enters a simulated recipient, sets an amount in tenge, and slides to confirm.
4. Keyboard users can focus the confirmation slider and submit with Enter.
5. Each transfer attempt gets a session ID that connects the phone interaction to its receipt and case.
6. The policy can approve the transfer, request an additional check, or place a simulated hold.
7. The phone displays the result and a reference number the analyst can trace.
8. Customers can reopen their account’s 50 most recent simulated receipts.
9. The mobile and analyst workspaces each remember their light or dark theme.
10. Explicit fixture mode lets presenters demonstrate selected scenarios with the services offline.

## What the phone measures

11. We built KinetiqSDK, a TypeScript telemetry collector that can run independently of React.
12. A React adapter starts and stops collection as the user moves through the transfer.
13. The SDK records when a key goes down, when it comes up, and the interval between presses.
14. It records touch position relative to the screen or control so different screen sizes can be compared.
15. Paired contacts distinguish actions such as entering an amount, reviewing details, and confirming.
16. The confirmation slider produces a trace of movement and browser-reported pressure where available.
17. With permission and sensor support, the SDK records phone acceleration and orientation.
18. It measures the actual motion sampling rate and retains up to 20 seconds of motion data.
19. The telemetry excludes typed digits, recipient details, clipboard contents, and real names.
20. Stopping collection clears listeners and buffers so the next account starts a separate session.

## How a transfer moves through the system

21. We used React and TypeScript for the interface, FastAPI for the bank backend, and a separate Python ML service.
22. Four shared contracts describe the telemetry submission, ML response, dashboard event, and mobile decision.
23. JSON schemas and synthetic fixtures let each team test its component against the same examples.
24. The backend verifies that the signed-in mobile account matches the submitted account ID.
25. Ingestion rejects unexpected fields, invalid numbers, impossible event timing, and oversized payloads.
26. The backend calls the ML service over HTTP, keeping service failures separate from the mobile interaction.
27. Live mode runs the trained model. Mock mode labels the identity evidence it supplies for demonstrations.
28. If ML misses its deadline, the backend makes the decision using the evidence available.
29. Retrying an identical submission returns the saved decision. Reusing its ID with different data raises a conflict.
30. The backend saves the case before broadcasting it, so the analyst can reopen the event received over WebSocket.

## How the model represents behavior

31. The identity service requires at least two usable behavioral streams to score a session.
32. It extracts 36 session statistics, including key dwell, typing cadence, swipe curvature, and motion features.
33. The raw sequence branch reads swipe coordinates, three acceleration channels, and phone roll.
34. A separate view divides the session into two-second windows that advance by one second.
35. Each window summarizes key dwell, contact dwell, pressure, motion, swipe speed, and key interval.
36. Six presence flags tell the window encoder which measurements were available.
37. A one-dimensional convolutional network learns short patterns along the motion and swipe traces.
38. A second convolutional branch reads the window sequence and pools windows containing observations.
39. A residual neural network processes the session statistics, and a fusion layer combines the three views.
40. The output is a normalized 128-number embedding that other sessions can be compared against.

## How identity and risk influence a decision

41. We trained the demo encoder on generated sessions labeled by simulated operator.
42. Qdrant stores the session vectors and searches for nearby behavioral patterns using cosine similarity.
43. An account alias identifies a login. An operator match is a hypothesis about who interacted with the phone.
44. An analyst can enroll an eligible session after independently verifying the account owner.
45. Three verified enrollments establish the initial owner baseline used for handoff checks.
46. Physical checks look for phone movement around a tap when the sensor coverage supports that comparison.
47. Possible coercion indicators include repeated typing bursts, long pauses, posture changes, and tremor-band motion.
48. The policy considers those indicators alongside owner mismatch, cross-account matches, and prior bans.
49. Explicit hold rules take priority, including a banned-operator match or a qualifying cross-account match.
50. Insufficient owner or recoil evidence can trigger an additional check when no hold rule has already applied.

## Storage, calibration, and account access

51. SQLite stores receipts, transfer outcomes, case details, and dashboard totals.
52. Embedded Qdrant keeps the demo’s behavioral vectors on the local machine.
53. Synthetic seed sessions and live submissions are kept separate during identity searches.
54. The rehearsal launcher creates a fresh local data directory and distinct demo credentials for each run.
55. Mobile and analyst logins use salted password hashes and separate expiring session cookies.
56. Guardian access is scoped to one account, and administrative actions require authorization.
57. Saving a raw calibration recording requires server-side capture to be enabled and consent for that transfer.
58. Consented recordings are written as private local files for later calibration work.
59. We traced a calibration warning to a rehearsal that offered the checkbox while server-side capture was disabled.
60. We looked up the receipt in SQLite and confirmed that the transfer and its case had been saved.

## What the analyst and Guardian can do

61. The transfer queue receives completed sessions and shows the decision and flags associated with each one.
62. An analyst can open a case to review its risk components, observed signals, and policy settings.
63. Signal windows show how the available measurements changed during a transfer.
64. The account directory supports alias searches and a transfer history filtered to one account.
65. Dashboard totals cover the database even when the interface displays a single page of recent sessions.
66. An analyst can download a prototype case dossier containing the evidence available for review.
67. Where available, the export includes a fingerprint derived from the full stored session embedding.
68. Authorized analysts can ban an operator and review subsequent matches against the banned profile.
69. The Guardian view shows held transfers for its account and acknowledges a hold once it is displayed.
70. An explicit Guardian action freezes the simulated transfer, and the saved freeze survives a restart.

## Making the population map understandable

71. We built a UMAP view that projects high-dimensional session embeddings into two dimensions.
72. Each dot represents one transfer session, so one account can appear in multiple places.
73. Nearby dots suggest similar interaction patterns. Different people can produce similar movements.
74. We removed numeric axis labels because moving left, right, up, or down has no inherent risk meaning.
75. The legend names the four statuses and shows how many sessions fall into each one.
76. Selecting a status emphasizes matching dots and narrows the group list.
77. A label on the plot shows how several sessions can overlap in one behavior group.
78. Selecting a group opens its sessions and associated accounts. Selecting a session opens its dossier.
79. We added an expanded view, zoom controls, panning, keyboard navigation, and a fit-to-view control.
80. We checked the map on desktop and phone-sized layouts, including a group whose label correctly opened nine sessions.

## What we verified

81. Seven synthetic scenarios covered ordinary transfers, synthetic touch, dictation, handoff, cross-account links, banned operators, and missing sensors.
82. A recorded verification run passed 21 shared contract and window tests, 17 backend tests, and seven ML tests.
83. After the map changes, the frontend built successfully and all 10 browser tests passed.
84. An isolated live run exercised scoring, three verified enrollments, owner approval, a cross-account hold, a ban, and re-entry.
85. We tested sensor denial, account switching, retries, duplicate events, reconnects, and database recovery.
86. The synthetic model evaluation compared 18 held-out query sessions with 18 reference sessions.
87. At the demo’s 0.80 similarity threshold, 16 of 18 same-profile pairs qualified as matches.
88. None of the 306 different-profile pairs crossed that threshold in this synthetic evaluation.
89. The correct operator ranked first for both eligible cross-account queries, a sample of two.
90. A transfer we traced in the running demo produced a map point with about 82 ms of ML inference time.

## Demo materials and remaining validation

91. We prepared an eight-slide offline pitch and a 60-second software rehearsal as a presentation backup.
92. An offline runbook covers local services, bundled assets, trusted HTTPS, and phone connectivity.
93. We produced a narrated animation following one synthetic transfer from fingertip to decision.
94. Its traces, learned responses, embedding values, comparison scores, and map coordinates came from the actual encoder.
95. We recut the explainer to 51 seconds and used Motion Video Director to remake its visual sequence.
96. The final 1080p film includes stereo audio, English captions, and nine chapters. [Watch the 51-second film](demo/sana-signal-directors-cut.mp4) · [Download the editable project](demo/sana-signal-directors-cut-source.zip)
97. Participant recordings are still needed to measure false matches and missed matches on real people.
98. Physical iPhone and Android testing is still needed across different grips, surfaces, and sensor conditions.
99. First-time users still need to test whether they can interpret the map and find a session without guidance.
100. A timed two-phone rehearsal on the intended network remains the final stage check.
