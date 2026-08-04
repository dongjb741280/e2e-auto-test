#!/bin/bash
# Convert CodeGraph SQLite database to Obsidian-compatible markdown notes
# Usage: ./scripts/codegraph-to-obsidian.sh <codegraph.db> <output-vault-dir>

set -e

DB="${1:?Usage: $0 <codegraph.db> <output-dir>}"
OUT="${2:?Usage: $0 <codegraph.db> <output-dir>}"

echo "CodeGraph → Obsidian converter"
echo "  Database: $DB"
echo "  Output:   $OUT"

rm -rf "$OUT"
mkdir -p "$OUT"

# ── Helper: sanitize filename ──
sanitize() { echo "$1" | sed 's/[:*?"<>|]/_/g'; }

# ── 1. File-level notes: one .md per source file ──
echo "[1/5] Generating file notes..."

sqlite3 "$DB" "
SELECT DISTINCT f.path, f.language, f.node_count, f.modified_at
FROM files f
WHERE f.path NOT LIKE '.agents/%'
  AND f.path NOT LIKE '.claude/%'
  AND f.path NOT LIKE '%.gitignore'
  AND f.path NOT LIKE '%.xml'
  AND f.path NOT LIKE '%.properties'
  AND f.language != 'xml'
ORDER BY f.path;
" | while IFS='|' read -r fpath lang count mtime; do
    # Determine module and tags
    tags=""
    module=""
    case "$fpath" in
        frontend/*) tags="frontend" ; module="frontend" ;;
        cc-api/*)   tags="backend/api" ; module="cc-api" ;;
        cc-core/*)  tags="backend/core" ; module="cc-core" ;;
        fs-api/*)   tags="backend/fs-api" ; module="fs-api" ;;
        fs-core/*)  tags="backend/fs-core" ; module="fs-core" ;;
        *)          tags="other" ; module="other" ;;
    esac

    case "$lang" in
        vue)    tags="$tags vue" ;;
        java)   tags="$tags java" ;;
        python) tags="$tags python" ;;
        javascript) tags="$tags javascript" ;;
    esac

    # Get symbols for this file
    symbols=$(sqlite3 -json "$DB" "
        SELECT kind, name, qualified_name, signature, visibility, start_line
        FROM nodes WHERE file_path='$fpath' AND kind NOT IN ('import','file')
        ORDER BY start_line;
    " 2>/dev/null || echo "[]")

    # Get imports (dependencies on other files)
    imports=$(sqlite3 -json "$DB" "
        SELECT DISTINCT
            n2.file_path AS target_file,
            n2.name AS target_name,
            n2.kind AS target_kind,
            n.name AS local_name
        FROM edges e
        JOIN nodes n ON e.source = n.id
        JOIN nodes n2 ON e.target = n2.id
        WHERE n.file_path = '$fpath'
          AND e.kind IN ('imports','calls','references','instantiates','extends','implements')
          AND n2.file_path != '$fpath'
          AND n2.file_path NOT LIKE '.agents/%'
        ORDER BY target_file;
    " 2>/dev/null || echo "[]")

    # Build markdown
    safe_name=$(sanitize "$fpath")
    dir_part=$(dirname "$safe_name")
    mkdir -p "$OUT/$dir_part"
    note="$OUT/${safe_name}.md"

    {
        echo "---"
        echo "type: file"
        echo "language: $lang"
        echo "module: $module"
        echo "symbols: $count"
        echo "tags: [$tags]"
        echo "path: $fpath"
        echo "---"
        echo ""
        echo "# $(basename "$fpath")"
        echo ""
        echo "> \`$fpath\` | $lang | $count symbols"
        echo ""

        # Symbols table
        symcount=$(echo "$symbols" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
        if [ "$symcount" -gt 0 ]; then
            echo "## Symbols ($symcount)"
            echo ""
            echo "| Kind | Name | Line | Visibility |"
            echo "|------|------|------|------------|"
            echo "$symbols" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for s in data[:50]:
    name = s.get('name','?')
    kind = s.get('kind','?')
    line = s.get('start_line','')
    vis = s.get('visibility','') or '-'
    print(f'| {kind} | \`{name}\` | {line} | {vis} |')
if len(data) > 50:
    print(f'| ... | *{len(data)-50} more symbols* | | |')
" 2>/dev/null
            echo ""
        fi

        # Dependencies
        depcount=$(echo "$imports" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
        if [ "$depcount" -gt 0 ]; then
            echo "## Dependencies ($depcount)"
            echo ""
            echo "$imports" | python3 -c "
import sys, json
data = json.load(sys.stdin)
seen = set()
for d in data:
    tf = d.get('target_file','')
    if tf and tf not in seen:
        seen.add(tf)
        name = d.get('target_name','')
        kind = d.get('target_kind','')
        safe = tf.replace('/','_').replace(':','_')
        print(f'- [[{tf}|{name}]] ({kind})')
if len(seen) > 30:
    print(f'\n*... and {len(data)-len(seen)} more references*')
" 2>/dev/null
            echo ""
        fi
    } > "$note"
done

# ── 2. Route index note ──
echo "[2/5] Generating route index..."

{
    echo "---"
    echo "type: index"
    echo "tags: [routes, api]"
    echo "---"
    echo ""
    echo "# API Routes"
    echo ""
    echo "| Method | Path | Controller |"
    echo "|--------|------|------------|"

    sqlite3 "$DB" "
        SELECT name, signature, file_path
        FROM nodes WHERE kind='route'
        ORDER BY file_path, name;
    " | while IFS='|' read -r name sig fpath; do
        method="${name%% *}"
        path="${name#* }"
        echo "| $method | \`$path\` | [[$fpath]] |"
    done

    echo ""
} > "$OUT/_Routes.md"

# ── 3. Frontend component index ──
echo "[3/5] Generating component index..."

{
    echo "---"
    echo "type: index"
    echo "tags: [components, frontend, vue]"
    echo "---"
    echo ""
    echo "# Frontend Components"
    echo ""
    echo "| Component | File |"
    echo "|-----------|------|"

    sqlite3 "$DB" "
        SELECT name, file_path
        FROM nodes WHERE kind='component'
        ORDER BY name;
    " | while IFS='|' read -r name fpath; do
        echo "| $name | [[$fpath]] |"
    done

    echo ""
} > "$OUT/_Components.md"

# ── 4. Project overview MOC ──
echo "[4/5] Generating project overview..."

{
    echo "---"
    echo "type: moc"
    echo "tags: [moc]"
    echo "---"
    echo ""
    echo "# AI Call Center — Code Map"
    echo ""

    total_nodes=$(sqlite3 "$DB" "SELECT COUNT(*) FROM nodes WHERE kind NOT IN ('import','file');")
    total_edges=$(sqlite3 "$DB" "SELECT COUNT(*) FROM edges;")
    total_files=$(sqlite3 "$DB" "SELECT COUNT(*) FROM files;")

    echo "- **${total_nodes}** code entities"
    echo "- **${total_edges}** relationships"
    echo "- **${total_files}** source files"
    echo ""

    echo "## Modules"
    echo ""

    for mod in frontend cc-api cc-core fs-api; do
        files_in_mod=$(sqlite3 "$DB" "SELECT COUNT(DISTINCT file_path) FROM nodes WHERE file_path LIKE '$mod/%';")
        nodes_in_mod=$(sqlite3 "$DB" "SELECT COUNT(*) FROM nodes WHERE file_path LIKE '$mod/%' AND kind NOT IN ('import','file');")
        echo "- **[[_Modules#${mod}|${mod}]]**: ${files_in_mod} files, ${nodes_in_mod} symbols"
    done

    echo ""
    echo "## Indexes"
    echo ""
    echo "- [[_Routes|API Routes]]"
    echo "- [[_Components|Frontend Components]]"
    echo "- [[_Modules|Module Structure]]"
    echo ""
    echo "## Entry Points"
    echo ""

    # Find key entry files
    sqlite3 "$DB" "
        SELECT DISTINCT f.path, f.language
        FROM files f
        WHERE f.path IN (
            'frontend/src/App.vue',
            'frontend/src/layout/Index.vue',
            'frontend/src/views/Login.vue',
            'frontend/src/views/SoftPhone.vue',
            'cc-api/src/main/java/com/voice9/api/Application.java',
            'fs-api/src/main/java/org/voice9/Application.java'
        )
        ORDER BY f.path;
    " | while IFS='|' read -r fpath lang; do
        echo "- [[$fpath|$(basename "$fpath")]] ($lang)"
    done

    echo ""
} > "$OUT/_Overview.md"

# ── 5. Module structure note ──
echo "[5/5] Generating module structure..."

{
    echo "---"
    echo "type: moc"
    echo "tags: [modules]"
    echo "---"
    echo ""
    echo "# Module Structure"
    echo ""

    for mod in frontend cc-api cc-core fs-api; do
        echo "## $mod"
        echo ""
        # Get top-level subdirectories with file counts
        sqlite3 "$DB" "
            SELECT DISTINCT
                substr(file_path, length('$mod/') + 1)
            FROM nodes
            WHERE file_path LIKE '$mod/%'
              AND file_path NOT LIKE '%/.agents/%';
        " | cut -d'/' -f1 | sort -u | while read -r dir; do
            count=$(sqlite3 "$DB" "SELECT COUNT(DISTINCT file_path) FROM nodes WHERE file_path LIKE '$mod/$dir/%';")
            echo "- **$dir/** ($count files)"
        done
        echo ""
    done
} > "$OUT/_Modules.md"

# ── Summary ──
file_count=$(find "$OUT" -name "*.md" | wc -l | tr -d ' ')
echo ""
echo "Done! Generated $file_count notes in $OUT"
echo ""
echo "To open in Obsidian:"
echo "  1. Open Obsidian"
echo "  2. Click 'Open folder as vault'"
echo "  3. Select: $(cd "$OUT" && pwd)"
echo "  4. Open _Overview.md to start"
