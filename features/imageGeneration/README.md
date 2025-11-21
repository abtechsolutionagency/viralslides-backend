# Image Generation Feature (Scenarios)

This directory groups everything related to the upcoming image scenario workflow:

- **constants/**: shared enums, limits, and defaults for scenario execution.
- **controllers/**: HTTP controllers that will expose CRUD + run-now endpoints.
- **models/**: MongoDB models for scenarios, runs, and generated assets.
- **routes/**: Express router wiring to plug into `server.js` when ready.
- **services/**: business logic for orchestrating prompt expansion, credit usage, and Make.com calls.
- **validators/**: Joi schemas that validate incoming payloads.
- **utils/**: helper modules (prompt builders, scheduling helpers, etc.).

Only placeholders exist right now; real implementations will land once requirements are finalized.
