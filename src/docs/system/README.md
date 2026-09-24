# System application - server parametrization

Server-side configuration and parameterization of the **system** application (`idapp`
`cfcd2084-95d5-65ef-66e7-dff9f98764da`): the operational AppVars, internal endpoints and
interval tasks that the platform itself uses, delivered over Telegram or other channels.

This section is scoped to the `system` app only. The settings documented here are **not**
generic or reusable as a bot pattern for other applications, and therefore they are kept
separate from the messaging bot skills (`src/docs/bots/`).

> **For AI agents:** this section is a **human** reference (operators/developers), like
> `flows/` or `auth/`. It is not served through any MCP tool and is not inlined into
> `AI_SKILL.md` files — nothing here should be assumed to apply to the `telegram` bot
> provider skill (`get_bot_provider_skill`).

## Index by topic

| File | Topics |
|---|---|
| [admin-notifications.md](./admin-notifications.md) | Admin alerts: error/intrusion/digest reports to a Telegram group and system admins · AppVars · fan-out · troubleshooting |