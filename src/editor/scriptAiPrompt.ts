/**
 * Build a single markdown blob describing the script sandbox in a form suitable
 * for pasting into an LLM prompt. Hand-written preamble + examples around
 * machine-generated signatures/fields from scriptApiDocs, so the two views of
 * the API stay single-sourced.
 */
import {
  SCRIPT_API,
  ROOM_FIELDS,
  AREA_FIELDS,
  ENV_FIELDS,
  type ApiEntry,
} from './scriptApiDocs';

function formatEntry(e: ApiEntry): string {
  const head = e.signature ?? (e.kind === 'function' ? `${e.name}(...)` : `${e.name}: ${e.detail}`);
  return `- \`${head}\` — ${e.info}`;
}

function formatField(e: ApiEntry): string {
  return `- \`${e.name}: ${e.detail}\` — ${e.info}`;
}

export function buildAiPrompt(): string {
  const reads = SCRIPT_API.filter((e) => e.detail === 'Read' && e.kind === 'function');
  const writes = SCRIPT_API.filter((e) => e.detail === 'Write');
  const io = SCRIPT_API.filter((e) => e.detail === 'I/O' || (e.kind !== 'function' && e.detail !== 'Read' && e.detail !== 'Write'));

  return `# Mudlet Map Editor — Script API

You are writing **JavaScript** that will run inside a browser-based Mudlet \`.dat\` map editor. Your code is executed via \`new Function(...)\` with a fixed set of helpers injected as parameters — nothing else is available. No \`fetch\`, no DOM, no modules, no Node APIs.

Format your response as normal markdown: wrap the script in a \`\`\`js … \`\`\` fenced code block with proper indentation, and use \`inline code\` for identifiers, function names, and field names. Do **not** add a \`runScript(...)\` wrapper or any surrounding boilerplate — the body inside the fence is pasted verbatim into the editor.

## Execution model

- The entire run is **one undo step**. A single Ctrl+Z reverts every change.
- If the script throws, **every applied change rolls back** automatically.
- Write helpers mutate the map eagerly, so subsequent reads see updated state.
- Snapshots from \`rooms()\` / \`room(id)\` / \`findRooms()\` / \`areas()\` / \`envs()\` are **frozen** and do NOT auto-update. Re-query after mutations if you need fresh state.
- \`return <value>\` at the top level displays the value as JSON below the editor. Use this to report results back to the user.
- Hard cap: 1,000,000 write commands per run.

## Coordinate convention

Raw Mudlet coordinates — **+Y = north**, +X = east, +Z = up. Pass un-flipped values to \`moveRoom\` and \`setCustomLine\`. The editor handles the render flip internally.

## Directions

The \`Direction\` type is one of:
\`'north'\`, \`'south'\`, \`'east'\`, \`'west'\`, \`'northeast'\`, \`'northwest'\`, \`'southeast'\`, \`'southwest'\`, \`'up'\`, \`'down'\`, \`'in'\`, \`'out'\`.

The constant \`DIRS\` is the full list.

## Read helpers

${reads.map(formatEntry).join('\n')}

## Globals & I/O

${io.map(formatEntry).join('\n')}

## Write helpers (all collected into one undo batch)

${writes.map(formatEntry).join('\n')}

## Room snapshot fields

${ROOM_FIELDS.map(formatField).join('\n')}

## Area snapshot fields

${AREA_FIELDS.map(formatField).join('\n')}

## Env snapshot fields

${ENV_FIELDS.map(formatField).join('\n')}

## Idioms

- **Filter then iterate:** \`for (const r of findRooms(p => ...)) { setRoomEnv(r.id, 5); }\`
- **Dry-run / preview:** return the candidate list *before* doing writes, so the user can confirm.
- **Report results:** \`return hits.map(r => ({ id: r.id, name: r.name }))\` — shows as JSON.
- **Operate on current view:** filter by \`r.area === currentAreaId && r.z === currentZ\`.
- **Infer a direction:** \`directionBetween(fromId, toId)\` or inspect \`r.x\` / \`r.y\` deltas.
- **Iterate exits:** \`for (const d of DIRS) { if (r[d] >= 0) { ... } }\`.

## Examples

### 1. Repaint rooms whose name contains a substring
\`\`\`js
const hits = findRooms(r => r.name.toLowerCase().includes('office'));
for (const r of hits) setRoomEnv(r.id, 5);
return hits.map(r => ({ id: r.id, name: r.name }));
\`\`\`

### 2. Audit: list rooms on the current floor with no exits
\`\`\`js
const orphans = findRooms(r =>
  r.area === currentAreaId &&
  r.z === currentZ &&
  DIRS.every(d => r[d] === -1 || r[d] === undefined)
);
return { count: orphans.length, ids: orphans.map(r => r.id) };
\`\`\`

### 3. Lock every door on rooms tagged as "vault"
\`\`\`js
for (const r of findRooms(r => r.userData.tag === 'vault')) {
  for (const d of DIRS) {
    if (r[d] >= 0) setDoor(r.id, d, 3); // 3 = locked
  }
}
\`\`\`

### 4. Connect two rooms (direction inferred)
\`\`\`js
const a = findRooms(r => r.name === 'Kitchen')[0];
const b = findRooms(r => r.name === 'Pantry')[0];
if (!a || !b) throw new Error('Kitchen or Pantry not found');
const used = connectRooms(a.id, b.id); // or { direction: 'up' } for non-2D
return { from: a.id, to: b.id, dir: used };
\`\`\`

### 5. Tag rooms via user data
\`\`\`js
const list = findRooms(r => r.environment === 7);
for (const r of list) setUserData(r.id, 'biome', 'forest');
return list.length;
\`\`\`
`;
}
