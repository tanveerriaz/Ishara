# Open the Qur’an vault (not the repo)

If Graph view shows `README`, `web/`, `scripts/`, or `data/`, you opened the **wrong folder**.

## Correct folder

```text
/Users/tanveerriaz/Projects/Ishara/vault
```

That folder contains only surah hubs, `Words/`, `Roots/`, and indexes — the meaning graph.

## Open it

Double-click **`Open Ishara Vault.command`** in the project, or run:

```bash
open -a Obsidian "/Users/tanveerriaz/Projects/Ishara/vault"
```

Then: Obsidian → **Settings → Manage vaults** → **Remove** any vault pointed at `Projects/Ishara` (the repo root).

Graph filter:

```text
path:Words OR path:Roots OR tag:#surah
```
