# Informes

Aquí dejan constancia el Director y QA. Una carpeta por spec:

```text
.claude/informes/
└── 001-cuenta-y-sesiones/
    ├── decisiones.md                  # Director, al planificar (y al cambiar algo)
    ├── qa-2026-12-01-bloque-1.md      # QA, al terminar cada bloque
    └── cierre.md                      # Director, al cerrar la spec
```

## Formato de `decisiones.md`

```markdown
# Decisiones técnicas · <spec>

| Fecha | Decisión | Por qué | Modelo |
| :--- | :--- | :--- | :--- |
| 2026-12-01 | Tokens de verificación en una tabla `email_tokens` | Un solo sitio para verificación y recuperación | Sonnet |
```

## Formato de los informes de QA

Lo define `.claude/agents/qa.md`. Resultado `PASS` o `FAIL`, tests ejecutados, criterios
de aceptación y hallazgos con pasos para reproducir.
