# ArguMentor 2.0

Virtual Courtroom Intelligence Platform for legal document ingestion, AI-assisted case analysis, argument strategy, and memo generation.

ArguMentor 2.0 is built as a production-style full-stack system with modular API routes, retrieval-friendly case memory, and AI reasoning pipelines for legal workflows.

## Product Vision

ArguMentor helps legal teams move from raw case files to actionable litigation intelligence:

- Ingest court documents and evidence in common formats.
- Extract structured legal entities, claims, defenses, and precedents.
- Generate strategic counterarguments.
- Estimate outcome probabilities with explainable signals.
- Maintain persistent case memory and weekly schedule groupings.
- Draft legal memos from reusable templates.

## Core Capabilities

- `Multi-format ingestion`: PDF, DOCX, PNG, JPG, JPEG, WEBP.
- `Case Intelligence`: AI-generated summary, reasoning, and structured legal metadata.
- `Conversational Assistant`: Real-time Socket.IO legal chat workflow.
- `Counterargument Generator`: Strategy outputs by side (`petitioner`, `respondent`, `both`).
- `Outcome Predictor`: Logistic scoring + model-generated rationale.
- `Case Memory`: Persisted memory records linked to case IDs.
- `Schedule Planner`: Create/rename/delete weekly schedules and assign cases.
- `Memo Builder`: Upload template and download AI-filled legal memo.
- `Operational Diagnostics`: Backend health and service validation endpoints.

## System Architecture

### Frontend
- React + TypeScript + Vite
- Single-page legal workflow interface with tabs for:
- Dashboard
- Case Analysis
- AI Assistant
- Counterarguments
- Outcome Predictor
- Case Memory
- Case Schedule

### Backend
- Node.js + Express (ESM)
- Socket.IO for live assistant responses
- MongoDB primary persistence with local fallback for key modules
- File ingestion via Multer
- Text extraction using `pdf-parse` and `mammoth`

### AI Layer
- Python inference orchestration (`mistral_inference.py`)
- Mistral API-backed reasoning for analysis/chat/memo generation
- Route-specific prompt construction with structured output parsing

## Repository Structure

```text
Argumentor 2.0/
|-- argumentor-react2/          # React frontend
|   |-- src/
|   `-- package.json
|-- server/                     # Express backend
|   |-- routes/                 # Feature APIs
|   |-- models/                 # Mongo/local persistence logic
|   |-- lib/                    # Shared utilities
|   `-- package.json
|-- ai_engine/                  # Alternate/auxiliary AI code path
|-- memo-templates/             # Uploaded memo template workspace
|-- uploads/                    # Runtime uploads (ignored in git)
|-- mistral_inference.py        # Primary Python inference entry
|-- QUICK_START.md
|-- SETUP_GUIDE.md
`-- README.md
```

## Technology Stack

- `Frontend`: React 19, TypeScript, Vite, TailwindCSS, Socket.IO client
- `Backend`: Node.js, Express, Socket.IO, Multer, MongoDB Node Driver
- `AI/ML`: Python, Mistral API integration
- `Document Processing`: `pdf-parse`, `mammoth`, `image-size`
- `Storage`: MongoDB with local fallback patterns for resilience

## API Surface (Primary)

All routes are mounted under `/api` unless noted.

- `POST /upload`: Upload and process case file.
- `GET /cases`: List available cases.
- `DELETE /cases/:caseId`: Delete case.
- `POST /analyze`: Analyze case by `caseId` or `caseTitle`.
- `POST /chat`: AI legal assistant request (Socket.IO client streaming).
- `POST /generate-counterarguments`: Generate strategic counters.
- `POST /predict-outcome`: Return plaintiff/defendant probability split.
- `GET /memory/:caseId`: Fetch case memory.
- `POST /memory/save`: Save/update case memory.
- `GET /schedules`: List schedules.
- `POST /schedules`: Create schedule.
- `PUT /schedules/:id`: Update schedule metadata.
- `DELETE /schedules/:id`: Delete schedule.
- `POST /schedules/:id/cases`: Add case into schedule.
- `PUT /schedules/:id/cases/:caseEntryId`: Update schedule case entry.
- `DELETE /schedules/:id/cases/:caseEntryId`: Remove schedule case entry.
- `POST /memo/generate`: Generate memo from uploaded template + case context.
- `GET /health`: Service health.
- `GET /api/test/all`: Full diagnostics sweep.

## Local Development Setup

## 1) Prerequisites

- Node.js 18+
- npm 9+
- Python 3.10+
- MongoDB (local or hosted)

## 2) Install Dependencies

```bash
# backend
cd server
npm install

# frontend
cd ../argumentor-react2
npm install
```

## 3) Configure Environment

Copy environment template and fill values:

```bash
copy server\.env.example server\.env
```

Required keys include:

- `MISTRAL_API_KEY`
- `MONGODB_URI`
- `MONGODB_DB`
- `PORT`

## 4) Build Frontend

```bash
cd argumentor-react2
npm run build
```

## 5) Start Backend (serves frontend build)

```bash
cd server
npm start
```

App will be available at:

- `http://localhost:5000`

## Operations and Reliability Notes

- MongoDB connection logic includes fallback URI attempts and health checks.
- Backend keeps JSON-safe error handling to reduce client-side ambiguity.
- API includes diagnostics for Python, environment variables, and external AI dependencies.
- Case delete/list APIs support local fallback behavior where Mongo is unavailable.

## Security and Compliance Notes

- Never commit `.env` files or API keys.
- Rotate credentials immediately if they were ever exposed.
- Add role-based auth and audit logs before production deployment.
- Introduce encryption at rest and PII redaction for legal-document handling in regulated environments.

## Patent Notice

This project concept and underlying idea are protected by patent ownership held by the project owner.

If you are evaluating this repository for commercial use, licensing, or partnership, contact the owner before reuse of patented concept components.

## Roadmap (Industry Readiness)

- Authentication and tenant isolation
- RBAC across law-firm roles
- Advanced citation tracing and source attribution
- Court-jurisdiction specific strategy packs
- Prompt/version governance and model observability
- CI/CD, containerization, and infrastructure-as-code

## Project Positioning

ArguMentor 2.0 is positioned as a legal-tech intelligence platform prototype with a production-oriented architecture, designed to be extended into a secure enterprise deployment model.

## Documentation

- `QUICK_START.md`
- `SETUP_GUIDE.md`

## License

All rights reserved unless otherwise specified by the project owner.
