#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
PAYLOAD_DIR="$APP_DIR/ops/catalog-import/2026-09-12"
MANIFEST="$PAYLOAD_DIR/manifest.json"
STATE_DIR="/var/lib/central-prints-autodeploy"
TMP_DIR="$(mktemp -d /tmp/central-prints-catalog.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

log(){ printf '[catalog-import] %s\n' "$*"; }
fail(){ printf '[catalog-import][ERRO] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
[ -f "$MANIFEST" ] || { log "Sem payload de catalogo; nada a fazer."; exit 0; }
for cmd in node npm sha256sum base64; do command -v "$cmd" >/dev/null 2>&1 || fail "Comando ausente: $cmd"; done
cd "$APP_DIR"

read_manifest(){ node --input-type=module - "$MANIFEST" "$1" <<'NODE'
import fs from 'node:fs';
const [, , file, key]=process.argv;
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const value=data[key];
if(value===undefined||value===null)process.exit(2);
process.stdout.write(String(value));
NODE
}

SOURCE_NAME="$(read_manifest source_name)"
SOURCE_SHA="$(read_manifest source_sha256)"
SOURCE_BYTES="$(read_manifest source_bytes)"
COMPRESSED_SHA="$(read_manifest compressed_sha256)"
COMPRESSED_BYTES="$(read_manifest compressed_bytes)"
PARTS="$(read_manifest parts)"
SOURCE_SLUG="$(read_manifest internal_source_slug)"
EXPECTED_ROWS="$(read_manifest expected_rows)"
EXPECTED_PRODUCTS="$(read_manifest expected_products)"
EXPECTED_CATEGORIES="$(read_manifest expected_categories)"

[[ "$SOURCE_SHA" =~ ^[a-f0-9]{64}$ ]] || fail "SHA de origem invalido."
[[ "$COMPRESSED_SHA" =~ ^[a-f0-9]{64}$ ]] || fail "SHA comprimido invalido."
[[ "$PARTS" =~ ^[0-9]+$ ]] || fail "Quantidade de partes invalida."
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/catalog-${SOURCE_SHA}.applied"

if [ -f "$STATE_FILE" ]; then
  log "Catalogo ja marcado como aplicado; executando verificacao integral novamente."
  node src/scripts/verify-full-catalog.js
  exit 0
fi

B64="$TMP_DIR/source.br.b64"
BR="$TMP_DIR/source.br"
RAW="$TMP_DIR/source.xls"
: > "$B64"
FOUND=0
while IFS= read -r part; do cat "$part" >> "$B64"; FOUND=$((FOUND+1)); done < <(find "$PAYLOAD_DIR" -maxdepth 1 -type f -name 'part-*.b64' | sort)
[ "$FOUND" -eq "$PARTS" ] || fail "Esperadas $PARTS partes; encontradas $FOUND."
base64 -d "$B64" > "$BR"
ACTUAL_COMPRESSED_BYTES="$(wc -c < "$BR" | tr -d ' ')"
[ "$ACTUAL_COMPRESSED_BYTES" = "$COMPRESSED_BYTES" ] || fail "Tamanho comprimido divergente: $ACTUAL_COMPRESSED_BYTES"
printf '%s  %s\n' "$COMPRESSED_SHA" "$BR" | sha256sum -c - >/dev/null

node --input-type=module - "$BR" "$RAW" <<'NODE'
import fs from 'node:fs';
import zlib from 'node:zlib';
const [, , source, target]=process.argv;
fs.writeFileSync(target,zlib.brotliDecompressSync(fs.readFileSync(source)),{mode:0o600});
NODE
ACTUAL_SOURCE_BYTES="$(wc -c < "$RAW" | tr -d ' ')"
[ "$ACTUAL_SOURCE_BYTES" = "$SOURCE_BYTES" ] || fail "Tamanho original divergente: $ACTUAL_SOURCE_BYTES"
printf '%s  %s\n' "$SOURCE_SHA" "$RAW" | sha256sum -c - >/dev/null
log "Payload reconstruido e verificado: $SOURCE_SHA"

log "Staging integral da tabela"
npm run supplier-price:import -- --file "$RAW" --source-name "$SOURCE_NAME" --supplier-slug "$SOURCE_SLUG" --expected-sha256 "$SOURCE_SHA" | tee "$TMP_DIR/stage.json"

log "Aplicacao transacional do catalogo"
npm run supplier-price:apply -- --source-name "$SOURCE_NAME" --confirm | tee "$TMP_DIR/apply.json"

log "Verificacao integral do catalogo"
VERIFY_JSON="$(node src/scripts/verify-full-catalog.js)"
printf '%s\n' "$VERIFY_JSON" | tee "$TMP_DIR/verify.json"

echo "$VERIFY_JSON" | grep -q '"ok": true' || fail "Verificacao integral nao confirmou ok=true."
echo "$VERIFY_JSON" | grep -q '"source_rows": 21329' || fail "Contagem de origem divergente."
echo "$VERIFY_JSON" | grep -q '"products": 1075' || fail "Contagem de produtos divergente."
echo "$VERIFY_JSON" | grep -q '"variants": 21329' || fail "Contagem de variantes divergente."
echo "$VERIFY_JSON" | grep -q '"categories": 140' || fail "Contagem de categorias divergente."

mkdir -p runtime
node --input-type=module - "$VERIFY_JSON" "$SOURCE_NAME" <<'NODE'
import fs from 'node:fs';
const [, , raw, sourceName]=process.argv;
const verify=JSON.parse(raw);
const payload={...verify,source_name:sourceName,verified_at:new Date().toISOString()};
const tmp=`runtime/.catalog-status-${process.pid}.json`;
fs.writeFileSync(tmp,JSON.stringify(payload,null,2)+'\n',{mode:0o644});
fs.renameSync(tmp,'runtime/catalog-status.json');
NODE
chmod 644 runtime/catalog-status.json
printf '%s\n' "source_sha256=$SOURCE_SHA applied_at=$(date -u +%FT%TZ) rows=$EXPECTED_ROWS products=$EXPECTED_PRODUCTS categories=$EXPECTED_CATEGORIES" > "$STATE_FILE"
chmod 600 "$STATE_FILE"
log "Catalogo integral aplicado e verificado."
