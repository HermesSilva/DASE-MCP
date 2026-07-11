<#
.SYNOPSIS
  Gera o pacote de release do dase-mcp: bump de versão, build (tsc + esbuild),
  smoke test do proxy stdio e artefatos em release/ (tarball npm + zip do plugin).

.DESCRIPTION
  Sincroniza a versão em package.json, claude-plugin/.claude-plugin/plugin.json
  e src/server/index.ts (SERVER_VERSION), recompila, valida os manifests JSON,
  faz um handshake MCP real contra o bundle e empacota:
    release/tootega-dase-mcp-<versão>.tgz   (npm pack — servidor standalone)
    release/dase-mcp-plugin-<versão>.zip    (claude-plugin/ — plugin Claude Code)

  O bundle claude-plugin/server/dase-mcp.cjs é artefato COMMITADO: instalação de
  plugin clona o repo e não roda npm install. Commit + push publicam de fato.

  Todos os arquivos são lidos/gravados como UTF-8 SEM BOM via [System.IO.File]
  (Get-Content/Set-Content do PS 5.1 corrompem UTF-8 sem BOM e inserem BOM).

.EXAMPLE
  ./scripts/prepare-release.ps1                   # incrementa o build: X.Y.<build+1>
  ./scripts/prepare-release.ps1 -Version 1.1.700  # define a versão exata (sem incremento)

.NOTES
  Esquema de versão: Major.Minor.Build. O build começa em 666 (primeira release)
  e incrementa a cada execução do script. package.json é a fonte da verdade.
#>
param(
    [string]$Version
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText((Join-Path $root $Path), [System.Text.Encoding]::UTF8)
}

function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText((Join-Path $root $Path), $Text, $utf8NoBom)
}

# ── 1. Versão (Major.Minor.Build — build inicia em 666 e incrementa a cada run) ──
$FIRST_BUILD = 666
$pkgJson = Read-Utf8 "package.json"
if (-not $Version) {
    $cur = ($pkgJson | ConvertFrom-Json).version
    if ($cur -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "Versão atual inválida no package.json: $cur" }
    $major = $Matches[1]; $minor = $Matches[2]; $build = [int]$Matches[3]
    $build = if ($build -lt $FIRST_BUILD) { $FIRST_BUILD } else { $build + 1 }
    $Version = "$major.$minor.$build"
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Versão inválida: $Version (esperado Major.Minor.Build)" }

Write-Host "Preparando release v$Version..." -ForegroundColor Cyan

# Bump por regex (1ª ocorrência de "version") — preserva formatação e encoding.
$reVersion = '("version":\s*)"[^"]+"'
Write-Utf8 "package.json" ([regex]::new($reVersion).Replace($pkgJson, "`$1`"$Version`"", 1))

$pluginPath = "claude-plugin/.claude-plugin/plugin.json"
Write-Utf8 $pluginPath ([regex]::new($reVersion).Replace((Read-Utf8 $pluginPath), "`$1`"$Version`"", 1))

# Constante de versão no código-fonte (servidor standalone).
$serverSrc = "src/server/index.ts"
Write-Utf8 $serverSrc ((Read-Utf8 $serverSrc) -replace 'const SERVER_VERSION = "[^"]*";', "const SERVER_VERSION = `"$Version`";")

# ── 2. Build ─────────────────────────────────────────────────────────────────
Write-Host "npm install + build..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install falhou" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build falhou" }
if (-not (Test-Path "claude-plugin/server/dase-mcp.cjs")) { throw "bundle claude-plugin/server/dase-mcp.cjs não gerado" }

# ── 3. Validação dos manifests ───────────────────────────────────────────────
Write-Host "Validando manifests..." -ForegroundColor Cyan
foreach ($m in @(".claude-plugin/marketplace.json", $pluginPath, "claude-plugin/.mcp.json")) {
    try { Read-Utf8 $m | ConvertFrom-Json | Out-Null }
    catch { throw "JSON inválido: $m — $_" }
}

# ── 4. Smoke test: handshake MCP real contra o bundle ───────────────────────
Write-Host "Smoke test do proxy (initialize via stdio)..." -ForegroundColor Cyan
$smokeJs = @'
const { spawn } = require("child_process");
const p = spawn(process.execPath, ["claude-plugin/server/dase-mcp.cjs"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const timer = setTimeout(() => { console.error("SMOKE TIMEOUT"); p.kill(); process.exit(1); }, 10000);
p.stdout.on("data", (d) => {
    buf += d.toString();
    const i = buf.indexOf("\n");
    if (i < 0) return;
    const msg = JSON.parse(buf.slice(0, i));
    const v = msg.result && msg.result.serverInfo && msg.result.serverInfo.version;
    clearTimeout(timer);
    p.kill();
    if (v !== process.argv[2]) { console.error("versao do serverInfo divergente: " + v); process.exit(1); }
    console.log("handshake OK - dase-mcp v" + v);
    process.exit(0);
});
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } }) + "\n");
'@
$smokeFile = Join-Path $env:TEMP "dase-mcp-smoke.js"
[System.IO.File]::WriteAllText($smokeFile, $smokeJs, $utf8NoBom)
node $smokeFile $Version
if ($LASTEXITCODE -ne 0) { throw "smoke test falhou" }
Remove-Item $smokeFile -Force

# ── 5. Artefatos ─────────────────────────────────────────────────────────────
Write-Host "Empacotando artefatos..." -ForegroundColor Cyan
$releaseDir = "release"
if (-not (Test-Path $releaseDir)) { New-Item -ItemType Directory $releaseDir | Out-Null }

# 5a. Tarball npm (biblioteca embutida + plugin, conforme "files" do package.json).
npm pack --pack-destination $releaseDir
if ($LASTEXITCODE -ne 0) { throw "npm pack falhou" }

# 5b. Zip do plugin Claude Code (conteúdo de claude-plugin/, para release manual).
$zipPath = Join-Path $releaseDir "dase-mcp-plugin-$Version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "claude-plugin/*" -DestinationPath $zipPath

Write-Host ""
Write-Host "Release v$Version pronto:" -ForegroundColor Green
Get-ChildItem $releaseDir | ForEach-Object { Write-Host ("  " + $_.Name + "  (" + [math]::Round($_.Length / 1kb) + " KB)") }
Write-Host ""
Write-Host "Próximos passos:" -ForegroundColor Yellow
Write-Host "  1. Revisar CHANGELOG.md (entrada v$Version)."
Write-Host "  2. Commitar (inclui claude-plugin/server/dase-mcp.cjs) e push no repo do marketplace."
Write-Host "  3. Testar: /plugin marketplace add <repo>  +  /plugin install dase-mcp"
