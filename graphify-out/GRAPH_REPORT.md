# Graph Report - luminol-academy-crm  (2026-11-20)

## Corpus Check
- 91 files · ~189,326 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 2, .example 1, .cmd 1)

## Summary
- 1091 nodes · 3382 edges · 60 communities (51 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `39a32eab`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- App.tsx
- index.mjs
- platform.mjs
- pages.tsx
- Этап 5: остальные пункты (4–11)
- package.json
- db.mjs
- Panel
- smart.mjs
- contacts
- useApp
- Button
- one
- api
- forms.tsx
- insights.tsx
- growth.tsx
- ml.mjs
- all
- Промпт: следующий большой этап Luminol Academy CRM
- ref_node_assert
- xlsx.ts
- compilerOptions
- n8n-intake.mjs
- vercel.json
- n8n-new-inquiries.ts
- 015_platform.sql
- ref_node_path
- Luminol Academy CRM
- 006_booking_and_reminders.sql
- n8n.test.mjs
- Промпт: этап «умная CRM» — ИИ-помощник, прогнозы, чат-бот для клиентов
- Product blueprint and architecture
- ref_node_fs
- round5.test.mjs
- opportunities
- Что осталось сделать вам
- Deployment status
- ref_node_url
- workbook.test.mjs
- platform.test.mjs
- reception.test.mjs
- roles.test.mjs
- DocumentDialog
- users
- admin.test.mjs
- Verification report
- n8n inquiry automation
- 016_smart.sql
- CLAUDE.md
- 011_team_tools.sql
- N8nInbox
- 002_login_attempts.sql
- 014_stock.sql

## God Nodes (most connected - your core abstractions)
1. `useApp()` - 157 edges
2. `Button()` - 110 edges
3. `api()` - 90 edges
4. `one()` - 81 edges
5. `Panel()` - 64 edges
6. `Badge()` - 56 edges
7. `all()` - 53 edges
8. `now()` - 51 edges
9. `users` - 47 edges
10. `Dialog()` - 47 edges

## Surprising Connections (you probably didn't know these)
- `submit()` --indirect_call--> `day()`  [INFERRED]
  src/booking.tsx → server/workbook-import.mjs
- `submit()` --indirect_call--> `zone()`  [INFERRED]
  src/roles.tsx → server/booking.mjs
- `sendDirect()` --indirect_call--> `text()`  [INFERRED]
  src/tools.tsx → server/index.mjs
- `trash` --references--> `users`  [EXTRACTED]
  server/migrations/005_academy_tools.sql → server/migrations/001_initial.sql
- `time_off` --references--> `users`  [EXTRACTED]
  server/migrations/006_booking_and_reminders.sql → server/migrations/001_initial.sql

## Import Cycles
- 2-file cycle: `src/academy.tsx -> src/tools.tsx -> src/academy.tsx`
- 2-file cycle: `server/integrations.mjs -> server/platform.mjs -> server/integrations.mjs`
- 2-file cycle: `server/integrations.mjs -> server/smart.mjs -> server/integrations.mjs`

## Communities (60 total, 9 thin omitted)

### Community 0 - "App.tsx"
Cohesion: 0.11
Nodes (34): AttendancePage(), App(), homeFor(), LanguagePicker(), locales, Login(), nav, navByRole (+26 more)

### Community 1 - "index.mjs"
Cohesion: 0.07
Nodes (62): allow(), allStaff, ApiError, appointmentFields(), assignableRoles, calendarRoles, canAcademic(), canAdmissions() (+54 more)

### Community 2 - "platform.mjs"
Cohesion: 0.15
Nodes (42): insert(), now(), fillTemplate(), billSubscriptions(), candidates(), collectEvents(), contactLanguage(), dailyDigest() (+34 more)

### Community 3 - "pages.tsx"
Cohesion: 0.13
Nodes (34): CashReport(), csv(), DebtsReport(), DirectorReport(), help, JournalPanel(), PayrollReport(), PrintReportButton() (+26 more)

### Community 4 - "Этап 5: остальные пункты (4–11)"
Cohesion: 0.04
Nodes (45): 10. Надёжность, 11. Удобство, 1. База данных — подключена ли она, 1. Онлайн-запись клиентов — страница `/book`, 2. Изменения в базе данных (миграция `004_real_workspace.sql`), 2. Рабочие часы и отпуска, 3. Напоминания, 3. Что просил заказчик → что сделано (+37 more)

### Community 5 - "package.json"
Cohesion: 0.05
Nodes (46): api(), handler, dependencies, @anthropic-ai/sdk@^1.10.0, express@^5.1.0, @fontsource-variable/dm-sans@^5.3.0, @fontsource-variable/noto-sans-arabic@^5.3.0, lucide-react@^0.468.0 (+38 more)

### Community 6 - "db.mjs"
Cohesion: 0.08
Nodes (28): databaseScope, db, dbPath, hashPassword(), isHosted, root, stages, verifyPassword() (+20 more)

### Community 7 - "Panel"
Cohesion: 0.10
Nodes (41): FeedbackPanel(), IntegrationStatus(), LoyaltyPanel(), BirthdaysPanel(), HeatBadge(), leadHeat(), Line, LowStockPanel() (+33 more)

### Community 8 - "smart.mjs"
Cohesion: 0.11
Nodes (42): @anthropic-ai/sdk, academyFacts(), aiConfigured(), ask(), clientFacts(), installAi(), languageName(), helpArticles (+34 more)

### Community 9 - "contacts"
Cohesion: 0.14
Nodes (24): activities, activities_contact, attendance, auth_sessions, automation_runs, charges, cohorts, contacts (+16 more)

### Community 10 - "useApp"
Cohesion: 0.15
Nodes (34): LanguageSection(), PsychologySection(), useApp(), esc(), useFeedbackRequest(), useInvoice(), serviceTone(), useRequestLabel() (+26 more)

### Community 11 - "Button"
Cohesion: 0.12
Nodes (20): actionLabel, ApiPanel(), BranchesAccessPanel(), CalendarFeedPanel(), conditionText(), copy(), delayText(), FieldsTagsPanel() (+12 more)

### Community 12 - "one"
Cohesion: 0.20
Nodes (28): chargeRows(), one(), academy(), chargilyBase(), chargilyConfigured(), createCheckout(), dueMessages(), fail() (+20 more)

### Community 13 - "api"
Cohesion: 0.06
Nodes (60): save(), TwoStepPanel(), disable(), enable(), start(), perform(), refresh(), login() (+52 more)

### Community 14 - "forms.tsx"
Cohesion: 0.10
Nodes (41): HelpDialog(), IntakeDialog(), IntakeQuestionsDialog(), MarkSheetDialog(), DocTemplatesPanel(), FlowDialog(), FormDialog(), appointmentKinds (+33 more)

### Community 15 - "insights.tsx"
Cohesion: 0.19
Nodes (20): addMonths(), Bars(), CustomDashboard(), defaultLayout(), dims, ForecastPanel(), InsightsTab(), lastMonths() (+12 more)

### Community 16 - "growth.tsx"
Cohesion: 0.11
Nodes (30): lucide-react, react, useAbsenceMessage(), addDays(), Calendar(), hhmm(), Item, layout() (+22 more)

### Community 17 - "ml.mjs"
Cohesion: 0.23
Nodes (16): auc(), heuristicLead(), heuristicNoShow(), json(), leadNames, leadRows(), leadSources, model() (+8 more)

### Community 18 - "all"
Cohesion: 0.30
Nodes (16): addDays(), busy(), fail(), freeSlots(), hasHours(), hhmm(), installPublicBooking(), onTimeOff() (+8 more)

### Community 19 - "Промпт: следующий большой этап Luminol Academy CRM"
Cohesion: 0.12
Nodes (15): 10. Абонементы с автосписанием и программа лояльности, 11. Филиалы и тонкие права, 12. Надёжность и скорость (нужен аккаунт Neon), 13. Открытый API и webhooks, 1. Единая «Входящие»: все сообщения в одном месте, 2. Конструктор автоматизаций, 3. Свои поля, метки и сегменты, 4. Свои формы вместо Google Forms и Tally (+7 more)

### Community 20 - "ref_node_assert"
Cohesion: 0.19
Nodes (5): request(), root, sentWhatsApp, state(), work

### Community 21 - "xlsx.ts"
Cohesion: 0.23
Nodes (13): load(), parseCsv(), load(), attr(), Cell, column(), entity(), inflate() (+5 more)

### Community 22 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, esModuleInterop, jsx, lib, module, moduleResolution, noEmit (+5 more)

### Community 23 - "n8n-intake.mjs"
Cohesion: 0.30
Nodes (18): audit(), initializeDatabase(), run(), transaction(), cleanStart(), installWhatsAppWebhook(), whatsappReply(), authenticate() (+10 more)

### Community 24 - "vercel.json"
Cohesion: 0.15
Nodes (12): includeFiles, maxDuration, buildCommand, crons, framework, functions, api/handler.mjs, headers (+4 more)

### Community 25 - "n8n-new-inquiries.ts"
Cohesion: 0.17
Nodes (10): batches, connectionTest, deliver, instructions, normalize, readLeads, receipt, sample (+2 more)

### Community 26 - "015_platform.sql"
Cohesion: 0.10
Nodes (25): api_keys, branches, comments, contact_tags, conversations, custom_fields, custom_values, doc_templates (+17 more)

### Community 27 - "ref_node_path"
Cohesion: 0.20
Nodes (4): root, work, root, work

### Community 28 - "Luminol Academy CRM"
Cohesion: 0.22
Nodes (8): A complete workflow to try, Assumptions and boundaries, GitHub and Vercel, Luminol Academy CRM, Open the application, Persistence and development, Sign in, What works

### Community 29 - "006_booking_and_reminders.sql"
Cohesion: 0.13
Nodes (17): appointments, appointments_start, appointments_staff, appointments_start, message_templates, meta, trash, appointments_staff (+9 more)

### Community 30 - "n8n.test.mjs"
Cohesion: 0.31
Nodes (7): capture(), folder, login(), request(), root, state(), work

### Community 31 - "Промпт: этап «умная CRM» — ИИ-помощник, прогнозы, чат-бот для клиентов"
Cohesion: 0.22
Nodes (8): 1. Чат-помощник для сотрудников «Demander à Luminol», 2. Чат-бот для клиентов в WhatsApp и на сайте (24/7), 3. Прогнозы (машинное обучение на своих данных, без внешних сервисов), 4. ИИ в повседневной работе, 5. Другое полезное, Правила работы, Промпт: этап «умная CRM» — ИИ-помощник, прогнозы, чат-бот для клиентов, Что для этого понадобится от вас

### Community 32 - "Product blueprint and architecture"
Cohesion: 0.25
Nodes (7): Access matrix, Components, Data integrity and metric definitions, Product blueprint and architecture, Product shape, Relational model, Security and operational limits

### Community 33 - "ref_node_fs"
Cohesion: 0.38
Nodes (5): ask(), request(), root, state(), work

### Community 34 - "round5.test.mjs"
Cohesion: 0.19
Nodes (8): adminPassword(), withDatabase(), createHostedHandler(), file, login(), request(), root, work

### Community 35 - "opportunities"
Cohesion: 0.16
Nodes (15): opportunities, opportunities_contact, programs, tasks, tasks_owner_due, incoming_inquiries, incoming_status, cohorts_new (+7 more)

### Community 36 - "Что осталось сделать вам"
Cohesion: 0.25
Nodes (7): Безопасность, Ключи в Vercel (Settings → Environment Variables), потом «Redeploy», Новое этого этапа — настроить один раз, Нужны аккаунты — скажите, когда будут, и я доделаю, Сразу (5 минут), Умная CRM (бесплатно) — настроить один раз, Что осталось сделать вам

### Community 37 - "Deployment status"
Cohesion: 0.29
Nodes (6): Administrator setup and verification, Deployment status, Durable storage, Live n8n inquiry automation, Operational boundaries, Published source and hosting

### Community 38 - "ref_node_url"
Cohesion: 0.40
Nodes (5): folder, login(), request(), root, work

### Community 39 - "workbook.test.mjs"
Cohesion: 0.29
Nodes (3): root, sheets, work

### Community 40 - "platform.test.mjs"
Cohesion: 0.33
Nodes (4): request(), root, state(), work

### Community 41 - "reception.test.mjs"
Cohesion: 0.29
Nodes (4): request(), root, state(), work

### Community 42 - "roles.test.mjs"
Cohesion: 0.33
Nodes (4): request(), root, state(), work

### Community 43 - "DocumentDialog"
Cohesion: 0.47
Nodes (6): DocumentDialog(), print(), render(), saveDoc(), pdfFromJpeg(), wrap()

### Community 44 - "users"
Cohesion: 0.20
Nodes (15): payments, refunds, users, grades, intake_forms, password_resets, placement_results, session_notes (+7 more)

### Community 45 - "admin.test.mjs"
Cohesion: 0.47
Nodes (5): request(), root, start(), state(), work

### Community 46 - "Verification report"
Cohesion: 0.33
Nodes (5): Automated checks, Browser checks, Hosted deployment checks, Limits of verification, Verification report

### Community 47 - "n8n inquiry automation"
Cohesion: 0.40
Nodes (4): Behavior, n8n inquiry automation, One-time credential setup, Verification

### Community 48 - "016_smart.sql"
Cohesion: 0.33
Nodes (6): ai_usage, assistant_messages, assistant_messages_user, bot_sessions, kb_articles, ml_models

### Community 52 - "011_team_tools.sql"
Cohesion: 0.40
Nodes (5): appointment_waitlist, cohort_materials, goals, login_events, login_events_time

### Community 53 - "N8nInbox"
Cohesion: 0.40
Nodes (3): guess(), N8nInbox(), open()

## Knowledge Gaps
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `api()` connect `api` to `App.tsx`, `index.mjs`, `pages.tsx`, `Panel`, `useApp`, `Button`, `forms.tsx`, `growth.tsx`, `N8nInbox`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.1141025641025641 - nodes in this community are weakly interconnected._
- **Why does `express` connect `package.json` to `index.mjs`, `ref_node_assert`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Should `index.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06538461538461539 - nodes in this community are weakly interconnected._
- **Why does `sendDirect()` connect `index.mjs` to `api`, `forms.tsx`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Should `platform.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1494949494949495 - nodes in this community are weakly interconnected._
- **Should `pages.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.1282051282051282 - nodes in this community are weakly interconnected._