# Behavioral identity service - Person Three

Person Three owns features, encoder, vector store, map, datasets, training, and the standalone service on port 8001. This scaffold does not implement those responsibilities.

Implement `POST /ml/embed-and-score` with Contract A input and Contract B output from `../contracts/`. Population-map, ban, and safe-baseline feedback interfaces require coordination as recorded in `../CONTRACTS.md`.

Person Two integrates through HTTP only. Review timing, sensor units, and missing-data semantics before using collected payloads for training.
