# Neighborhood Council App — Backend

Node.js REST API backend for the Neighborhood Council App, handling all data operations for councils, elections, complaints, committees, and treasury management.

## Overview

This backend powers the Neighborhood Council App's core governance features — council creation, digital elections, complaint tracking with committee resolution workflows, and treasury/budget management. It connects to a Microsoft SQL Server database and serves the [Flutter mobile app](https://github.com/sirajhassankhan/neigbourhood_council_app) via a REST API.

## Features

- **Council management** — create and manage neighborhood councils, handle membership requests
- **User management** — registration, login, profile management, password hashing (bcrypt)
- **Elections** — candidate nominations, election panels, voting, and results
- **Complaint management** — submission, tracking, committee assignment, and resolution
- **Committee system** — committee formation and complaint handling by committees
- **Budget & treasury** — budget requests and fund release tracking
- **Notifications** — real-time updates for elections, complaints, and announcements
- **Suggestions** — members can submit suggestions to their council
- **File uploads** — image and document uploads for complaints, resolutions, and meeting minutes (via Multer)

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** Microsoft SQL Server (via `mssql`)
- **Authentication:** bcrypt for password hashing
- **File Uploads:** Multer
- **Environment Config:** dotenv

## Frontend Repository

The cross-platform Flutter mobile client for this system can be found at:
👉 [Neighborhood Council App Frontend](https://github.com/sirajhassankhan/neigbourhood_council_app)

## Project Structure

```
.
├── controllers/    # Business logic for each feature (users, elections, complaints, budget, etc.)
├── routes/         # API route definitions
├── db.js           # Database connection configuration
├── server.js        # App entry point
└── .env.example      # Environment variable template
```

## API Routes

| Base Path | Purpose |
|---|---|
| `/api/users` | User registration, login, profile |
| `/api/nhc` | Neighborhood council creation and management |
| `/api/requests` | Council change requests |
| `/api/nominations` | Election candidate nominations |
| `/api/candidates` | Candidate management |
| `/api/elections` | Election scheduling and voting |
| `/api/positions` | Council positions (President, VP, Treasurer) |
| `/api/complaint` | Complaint submission and tracking |
| `/api/committee` | Committee formation and management |
| `/api/budget` | Budget requests and treasury fund releases |
| `/api/suggestion` | Member suggestions |
| `/api/notifications` | Real-time notifications |

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your own values:
   ```bash
   cp .env.example .env
   ```
4. Update `.env` with your SQL Server credentials and a JWT/session secret
5. Run the server:
   ```bash
   node server.js
   ```
   The API will run on `http://localhost:5000` by default.

## Documentation

The original project documentation (shared team brief covering the full project scope, objectives, and requirements) is available as a PDF: [Documentation.pdf](./Documentation.pdf)

> Note: This document describes the overall project concept as assigned to a team of three students. Each team member independently designed and built their own complete implementation using a technology stack of their choice. This repository represents my individual backend implementation — built with Node.js, Express, and SQL Server — and may differ in specific technologies from what is described in the shared documentation (e.g., authentication method, third-party integrations).

## Author

Siraj Hassan Khan — BSCS, PMAS Arid Agriculture University Rawalpindi
