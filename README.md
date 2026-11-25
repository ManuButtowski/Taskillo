# Taskillo

Gestor de tareas personal para PC (Windows) y Android, con recurrencias, alarmas, cuadrante
horario y sincronización sin conexión. En fases posteriores: widget, gamificación (copas y
rachas) y una capa social con control fino de la privacidad.

Se desarrolla con **Spec-Driven Development** ([Spec-Kit](https://github.com/github/spec-kit))
y un harness de agentes de Claude Code (Director, Desarrollo, QA y Redactor).

| Documento | Para qué |
| :--- | :--- |
| [`docs/especificacion.md`](docs/especificacion.md) | Especificación funcional y técnica completa (v2.0) |
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | Principios y reglas que no se negocian |
| [`specs/README.md`](specs/README.md) | Specs del MVP, orden de trabajo y fases siguientes |
| [`CLAUDE.md`](CLAUDE.md) | Cómo trabajar con los agentes en Claude Code |

## Stack

Flutter (Windows + Android) · TypeScript + Hono + Drizzle · PostgreSQL (Neon) · Cloudflare R2 ·
correo por SMTP de IONOS (Resend como alternativa) · API en el VPS IONOS de DEVKOMP,
desplegada con GitHub Actions. Presupuesto: 0 €.

Los secretos nunca se suben: copia `.env.example` a `.env` y rellénalo (ver la sección
"Secretos" de la constitución).
