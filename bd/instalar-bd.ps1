<#
.SYNOPSIS
    Cria (ou recria) o banco do Sistema Integrado de Gestao Empresarial e Financeira.

.DESCRIPTION
    Executa, em ordem:
      1. valida que o psql esta acessivel
      2. cria a role gestao_owner (se nao existir) e o banco
      3. roda 01_schema_core.sql, 02_schema_financeiro.sql, 03_schema_contabil_governanca.sql
      4. opcionalmente roda 99_smoke_test.sql

    Deve ser executado a partir da pasta que contem os arquivos .sql.

.PARAMETER Banco
    Nome do banco a criar. Padrao: gestao_empresarial

.PARAMETER Recriar
    Derruba o banco antes de criar. APAGA TODOS OS DADOS do banco informado.

.PARAMETER SmokeTest
    Roda 99_smoke_test.sql no final. Insere dados de teste -- use so em banco descartavel.

.EXAMPLE
    .\instalar-bd.ps1
    Instalacao limpa em gestao_empresarial.

.EXAMPLE
    .\instalar-bd.ps1 -Banco gestao_dev -Recriar -SmokeTest
    Recria gestao_dev do zero e valida com o smoke test.
#>

[CmdletBinding()]
param(
    [string] $Banco       = 'gestao_empresarial',
    [string] $Owner       = 'gestao_owner',
    [string] $Superusuario = 'postgres',
    [string] $Host_        = 'localhost',
    [int]    $Porta        = 5432,
    [switch] $Recriar,
    [switch] $SmokeTest
)

$ErrorActionPreference = 'Stop'

function Escreve($msg, $cor = 'White') { Write-Host $msg -ForegroundColor $cor }

# -----------------------------------------------------------------------------
# 1. Localizar o psql
# -----------------------------------------------------------------------------
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Escreve 'psql nao esta no PATH. Procurando a instalacao...' Yellow
    $bin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
           Sort-Object Name -Descending |
           ForEach-Object { Join-Path $_.FullName 'bin' } |
           Where-Object { Test-Path (Join-Path $_ 'psql.exe') } |
           Select-Object -First 1

    if (-not $bin) {
        throw 'psql.exe nao encontrado. Instale o PostgreSQL ou adicione a pasta bin ao PATH.'
    }
    $env:Path = "$env:Path;$bin"
    Escreve "psql encontrado em: $bin" Green
}

Escreve ("Versao do cliente: " + (psql --version)) Gray

# -----------------------------------------------------------------------------
# 2. Conferir se os scripts estao na pasta atual
# -----------------------------------------------------------------------------
$scripts = @(
    '01_schema_core.sql',
    '02_schema_financeiro.sql',
    '03_schema_contabil_governanca.sql',
    '04_ajustes_integracao_backend.sql',
    '05_auditoria_sprint2.sql'
)

$faltando = $scripts | Where-Object { -not (Test-Path $_) }
if ($faltando) {
    throw "Arquivo(s) nao encontrado(s) nesta pasta: $($faltando -join ', '). Rode o script de dentro da pasta bd."
}

# -----------------------------------------------------------------------------
# 3. Senhas
# -----------------------------------------------------------------------------
Escreve ''
Escreve "Senha do superusuario '$Superusuario' (para criar role e banco):" Cyan
$senhaSuper = Read-Host -AsSecureString |
              ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }

Escreve "Senha a definir/usar para a role '$Owner':" Cyan
$senhaOwner = Read-Host -AsSecureString |
              ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }

if ([string]::IsNullOrWhiteSpace($senhaOwner)) { throw 'A senha do owner nao pode ser vazia.' }

# -----------------------------------------------------------------------------
# 4. Criar role e banco (como superusuario)
# -----------------------------------------------------------------------------
function Psql-Super([string] $sql) {
    $env:PGPASSWORD = $senhaSuper
    $saida = psql -U $Superusuario -h $Host_ -p $Porta -d postgres -v ON_ERROR_STOP=1 -q -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Falha ao executar: $sql`n$saida" }
    return $saida
}

Escreve ''
Escreve '--- Preparando role e banco ---' Cyan

# A role precisa de CREATEROLE: o script 03 executa CREATE ROLE app_gestao.
$existeRole = (Psql-Super "SELECT 1 FROM pg_roles WHERE rolname = '$Owner';") -match '1'

if ($existeRole) {
    Psql-Super "ALTER ROLE $Owner WITH LOGIN CREATEROLE PASSWORD '$senhaOwner';" | Out-Null
    Escreve "Role '$Owner' ja existia -- senha e atributos atualizados." Green
} else {
    Psql-Super "CREATE ROLE $Owner WITH LOGIN CREATEROLE PASSWORD '$senhaOwner';" | Out-Null
    Escreve "Role '$Owner' criada." Green
}

if ($Recriar) {
    Escreve ''
    Escreve "ATENCAO: o banco '$Banco' sera APAGADO com todos os seus dados." Yellow
    $conf = Read-Host "Digite o nome do banco para confirmar"
    if ($conf -ne $Banco) { throw 'Confirmacao nao confere. Nada foi alterado.' }

    Psql-Super "DROP DATABASE IF EXISTS $Banco WITH (FORCE);" | Out-Null
    Psql-Super "DROP ROLE IF EXISTS app_gestao;"              | Out-Null
    Escreve "Banco '$Banco' removido." Green
}

Psql-Super "CREATE DATABASE $Banco OWNER $Owner;" | Out-Null
Escreve "Banco '$Banco' criado com owner '$Owner'." Green

# -----------------------------------------------------------------------------
# 5. Rodar os scripts de schema (como owner, NAO como superusuario)
# -----------------------------------------------------------------------------
# Rodar como superusuario faria a RLS ser ignorada silenciosamente.
$env:PGPASSWORD = $senhaOwner

Escreve ''
Escreve '--- Instalando o schema ---' Cyan

foreach ($s in $scripts) {
    Escreve "  $s ..." Gray
    psql -U $Owner -h $Host_ -p $Porta -d $Banco -w -v ON_ERROR_STOP=1 -q -f $s
    if ($LASTEXITCODE -ne 0) { throw "Erro em $s. A instalacao foi interrompida." }
    Escreve "  $s OK" Green
}

# -----------------------------------------------------------------------------
# 6. Smoke test (opcional)
# -----------------------------------------------------------------------------
if ($SmokeTest) {
    if (-not (Test-Path '99_smoke_test.sql')) {
        Escreve '99_smoke_test.sql nao encontrado -- etapa pulada.' Yellow
    } else {
        Escreve ''
        Escreve '--- Smoke test ---' Cyan
        Escreve 'O ultimo bloco DEVE falhar (lancamento desbalanceado). Isso e sucesso.' Gray
        Escreve ''
        psql -U $Owner -h $Host_ -p $Porta -d $Banco -w -f '99_smoke_test.sql'
        Escreve ''
        Escreve 'Confira acima: 200 un a custo medio 3.00, parcela PARCIALMENTE_LIQUIDADA' Gray
        Escreve 'com saldo 300, e o ERRO de lancamento desbalanceado no final.' Gray
    }
}

# -----------------------------------------------------------------------------
# 7. Resumo
# -----------------------------------------------------------------------------
$env:PGPASSWORD = $null

Escreve ''
Escreve '=== Concluido ===' Green
Escreve ''
Escreve 'String de conexao do owner (migrations / DDL):' Cyan
Escreve "  postgresql://${Owner}:<senha>@${Host_}:${Porta}/${Banco}?schema=gestao"
Escreve ''
Escreve 'String de conexao da API (role sge_api, criada pelo script 04, sujeita a RLS):' Cyan
Escreve "  postgresql://sge_api:sge_api@${Host_}:${Porta}/${Banco}?schema=gestao"
Escreve 'Troque a senha de sge_api antes de usar fora de desenvolvimento:' Gray
Escreve "  psql -U $Superusuario -c ""ALTER ROLE sge_api WITH PASSWORD 'senha_forte';"""
Escreve ''
Escreve 'Lembrete: a aplicacao precisa executar, dentro da transacao de cada requisicao,' Yellow
Escreve 'SET LOCAL app.empresa_id e app.usuario_id. Sem isso a RLS retorna zero linhas' Yellow
Escreve 'sem gerar erro nenhum.' Yellow