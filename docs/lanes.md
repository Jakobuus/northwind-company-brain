# Lanes (who owns which folders)

| Lane | Owns | Typical work on the day |
|---|---|---|
| data | `brain/intake/**`, `data/**`, `policy.yaml` files, `brain/embed.py` | import supplied data, extract facts, access file, meaning index |
| rules | `brain/store.py access.py precedence.py search.py ask.py people.py` | precedence, access, expertise tweaks |
| app | `brain/server.py cli.py graph.py obsidian.py`, `web/**` | graph page, ask panel, MCP link, Obsidian view, demo |

Shared: `brain/schema.py`, `docs/design.md`, `tests/test_contract.py` (contract PRs only).
Suggested split for two people: person A = data + rules, person B = app.
