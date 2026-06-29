# Shiftopia — AI-Powered Workforce Scheduling & Shift Management

Shiftopia is a cross-platform workforce scheduling platform for hospitality, retail, and event industries. It enables managers to create and publish shifts, employees to bid on open shifts, request swaps, manage availability, and track attendance — all while ensuring compliance with Australian labour laws.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI | Tailwind CSS, Radix UI, Shadcn/ui |
| State | TanStack Query (React Query), Zustand |
| Backend | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| Edge Functions | Deno (shift lifecycle automation) |
| Optimizer | Python OR-Tools CP-SAT (constraint-solving auto-scheduler) |
| ML Service | Python FastAPI (demand forecasting) |
| Monitoring | Sentry (error tracking + source maps) |
| CI/CD | GitHub Actions (tsc + vitest + build) |
| i18n | i18next |

## Features

- **Shift Rostering** — Create, publish, and manage shifts with drag-and-drop scheduling
- **Shift Bidding** — Employees bid on open shifts; managers approve/reject
- **Shift Swapping** — Employees request and approve peer-to-peer shift swaps
- **Compliance Engine** — Real-time validation against Australian labour laws (Fair Work Act, rest gaps, max hours, student visa limits)
- **Auto-Scheduler** — OR-Tools constraint solver for optimal shift assignment
- **Demand Forecasting** — ML-based labour demand predictions
- **Timesheets** — Attendance tracking and payroll integration
- **Broadcasts** — Manager-to-team announcements with read tracking
- **Insights & Analytics** — Workforce analytics dashboards
- **Templates** — Reusable shift templates
- **Availability Management** — Employee availability preferences
- **Role-Based Access Control** — Admin, Manager, Employee permission tiers
- **Real-Time Updates** — Supabase Realtime for live shift changes
- **Dark Mode** — Full dark mode support

## Domain Modules

```
src/modules/
├── auth/           # Authentication & authorization
├── availability/   # Employee availability management
├── broadcasts/     # Announcements and notifications
├── compliance/     # Labour law compliance engine (v2)
├── core/           # Shared components, error boundaries, layout
├── insights/       # Analytics and reporting dashboards
├── planning/       # Shift bidding and swap requests
├── rosters/        # Shift scheduling and roster management
├── search/         # Global search
├── scheduling/     # Auto-scheduler (OR-Tools integration)
├── settings/       # Organization settings
├── templates/      # Shift templates
├── timesheets/     # Time tracking and payroll
└── users/          # User management and profiles
```

## Getting Started

### Prerequisites

- Node.js 20+ ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
- npm 10+
- Docker (for optimizer + ML services)

### Setup

```sh
# 1. Clone the repository
git clone <YOUR_GIT_URL>
cd Superman_ULTIMATE

# 2. Install dependencies
npm install

# 3. Copy environment variables
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Start the development server
npm run dev
```

### Running Microservices

```sh
# Start the optimizer + ML services
docker compose up -d
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 8080) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run test` | Run unit tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run type-check` | TypeScript type checking |
| `npm run arch:validate` | Validate module dependency rules |
| `npm run arch:graph` | Generate dependency graph SVG |

## Architecture

See [docs/architecture-overview.md](docs/architecture-overview.md) for detailed architecture documentation.

### Key Flows

- **Shift Lifecycle:** `draft → scheduled → active → completed` (or `→ cancelled`)
- **Bid Lifecycle:** `pending → approved → confirmed` (or `→ rejected`)
- **Swap Lifecycle:** `pending → approved → executed` (or `→ rejected`)

## Environment Variables

See [.env.example](.env.example) for all configuration options including:
- Supabase connection (required)
- ML service URL
- Sentry error monitoring
- Build configuration

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](docs/architecture-overview.md) | System architecture and module ownership |
| [DDD Module Standards](docs/ddd-module-standards.md) | Domain-driven design conventions |
| [Autoscheduler Guide](docs/autoscheduler.md) | OR-Tools optimizer documentation |
| [Operational Runbook](docs/operational-runbook.md) | Production operations guide |
| [Release Checklist](docs/release-checklist.md) | Pre-release verification steps |
| [Hardening Report](HARDENING_2026-04-29.md) | Security & performance hardening pass |

## License

Proprietary — All rights reserved.

## 问题：
1. My Notifications里All标签的通知打勾以后就消失了，正常逻辑应该是：在 Unread 标签中，打勾代表“标记为已读”，通知会从未读列表消失。在 All 标签中，打勾后通知应该继续显示，只是变成已读样式。
2. Notifications，Broadcast，offer inbox做了三个入口，在app里显示太繁杂。可以合并成一个inbox，但不改变底层业务表：
All：全部消息
Action Required：待接受/拒绝的 Offer、换班请求
Announcements：Broadcast 公告
Updates：排班、竞标、换班结果等普通通知
用户点击消息后：
Offer 可直接接受/拒绝，或进入班次详情
Broadcast 进入公告正文并下载附件
普通通知跳转到对应业务页面
