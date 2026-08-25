<#
.SYNOPSIS
    Recria do zero o banco do Sistema Integrado de Gestao Empresarial e Financeira.

.DESCRIPTION
    Tem dois modos.

    Instalacao (padrao) -- ATENCAO: APAGA o banco informado, com todos os seus
    dados, antes de criar. Os scripts 01 a 03 montam o schema do zero: nao sao
    migracoes e nao se aplicam sobre um banco existente. Executa, em ordem:
      1. valida que o psql esta acessivel
      2. derruba o banco e as roles da aplicacao (app_gestao, sge_api)
      3. cria/atualiza a role gestao_owner e cria o banco
      4. roda 01 a 12 (schema, integracao, auditoria, RH, parceiros, catalogo,
         estoque, financeiro, fluxo de caixa, compras e documentos fiscais)
      5. opcionalmente roda 99_smoke_test.sql

    Atualizacao (-Atualizar) -- PRESERVA os dados. Nao apaga nada e nao pede a
    senha do superusuario: roda apenas os scripts de ajuste (04 a 15), que sao
    idempotentes e reaplicaveis. E o caminho para levar um banco de uma sprint
    anterior ate a atual sem perder o que ja foi cadastrado.

    Deve ser executado a partir da pasta que contem os arquivos .sql.

.PARAMETER Banco
    Nome do banco a recriar (ou a atualizar). Padrao: gestao_empresarial

.PARAMETER Atualizar
    Aplica so os scripts de ajuste (04 a 15) sobre um banco existente, sem
    apagar dados. Incompativel com -Forcar.

.PARAMETER Forcar
    Nao pede confirmacao antes de apagar um banco existente. Para automacao.

.PARAMETER Recriar
    Obsoleto: recriar passou a ser o comportamento padrao. Mantido como
    sinonimo de -Forcar para nao quebrar quem ja usava o script.

.PARAMETER SmokeTest
    Roda 99_smoke_test.sql no final. Insere dados de teste -- use so em banco descartavel.

.EXAMPLE
    .\instalar-bd.ps1
    Recria gestao_empresarial, confirmando antes se o banco ja existir.

.EXAMPLE
    .\instalar-bd.ps1 -Banco gestao_dev -Forcar -SmokeTest
    Recria gestao_dev sem perguntar e valida com o smoke test.

.EXAMPLE
    .\instalar-bd.ps1 -Atualizar
    Aplica os ajustes das sprints (04 a 15) em gestao_empresarial, sem apagar
    dados. E o que rodar depois de atualizar o repositorio.
#>

[CmdletBinding()]
param(
    [string] $Banco       = 'gestao_empresarial',
    [string] $Owner       = 'gestao_owner',
    [string] $Superusuario = 'postgres',
    [string] $Host_        = 'localhost',
    [int]    $Porta        = 5432,
    [switch] $Atualizar,
    [switch] $Forcar,
    [switch] $Recriar,
    [switch] $SmokeTest
)

$ErrorActionPreference = 'Stop'

# -Atualizar preserva dados; -Forcar existe para pular a confirmacao de um DROP
# que, nesse modo, nao acontece. Juntos, so podem significar que quem chamou
# esperava um dos dois comportamentos -- e errar qual seria apagar o banco.
if ($Atualizar -and ($Forcar -or $Recriar)) {
    throw '-Atualizar nao se combina com -Forcar/-Recriar: um preserva os dados, o outro apaga o banco.'
}

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
# 01 a 03 criam o schema: so rodam em banco novo.
$scriptsBase = @(
    '01_schema_core.sql',
    '02_schema_financeiro.sql',
    '03_schema_contabil_governanca.sql'
)

# 04 em diante sao ajustes idempotentes -- e por isso o que -Atualizar reaplica.
# Toda sprint nova entra aqui.
$scriptsAjuste = @(
    '04_ajustes_integracao_backend.sql',
    '05_auditoria_sprint2.sql',
    '06_rh_sprint3.sql',
    '07_parceiros_produtos_sprint4.sql',
    '08_estoque_sprint5.sql',
    '09_financeiro_sprint6.sql',
    '10_fluxo_caixa_sprint7.sql',
    '11_compras_sprint8.sql',
    '12_documentos_fiscais_sprint9.sql',
    '13_bancos_sprint10.sql',
    '14_conciliacao_sprint11.sql',
    '15_ocr_sprint12.sql'
)

$scripts = $scriptsBase + $scriptsAjuste
$aRodar  = if ($Atualizar) { $scriptsAjuste } else { $scripts }

$faltando = $aRodar | Where-Object { -not (Test-Path $_) }
if ($faltando) {
    throw "Arquivo(s) nao encontrado(s) nesta pasta: $($faltando -join ', '). Rode o script de dentro da pasta bd."
}

# -----------------------------------------------------------------------------
# 3. Senhas
# -----------------------------------------------------------------------------
Escreve ''

# Em -Atualizar nada e criado no cluster: nao ha por que pedir (nem manter em
# memoria) a senha do superusuario.
$senhaSuper = $null
if (-not $Atualizar) {
    Escreve "Senha do superusuario '$Superusuario' (para criar role e banco):" Cyan
    $senhaSuper = Read-Host -AsSecureString |
                  ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }
}

Escreve "Senha da role '$Owner':" Cyan
$senhaOwner = Read-Host -AsSecureString |
              ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }

if ([string]::IsNullOrWhiteSpace($senhaOwner)) { throw 'A senha do owner nao pode ser vazia.' }

# -----------------------------------------------------------------------------
# 4. Recriar role e banco (como superusuario)
# -----------------------------------------------------------------------------
# -Valor devolve so o dado (psql -t -A), sem cabecalho nem "(1 row)": e o que
# permite comparar o resultado com '1' sem depender do formato da tabela.
function Psql-Super([string] $sql, [switch] $Valor) {
    $env:PGPASSWORD = $senhaSuper
    $psqlArgs = @('-U', $Superusuario, '-h', $Host_, '-p', $Porta, '-d', 'postgres',
                  '-v', 'ON_ERROR_STOP=1', '-q')
    if ($Valor) { $psqlArgs += @('-t', '-A') }

    $saida = psql @psqlArgs -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Falha ao executar: $sql`n$saida" }
    return $saida
}

function Existe([string] $sql) {
    return ((Psql-Super $sql -Valor) -join '').Trim() -eq '1'
}

Escreve ''

if ($Atualizar) {
    Escreve '--- Conferindo o banco a atualizar ---' Cyan

    # Um erro de digitacao em -Banco criaria, sem esta checagem, a impressao de
    # que a atualizacao rodou -- num banco que nao e o do projeto.
    #
    # $ErrorActionPreference volta a 'Continue' so aqui: com 'Stop', a stderr do
    # psql (capturada por 2>&1) vira NativeCommandError e aborta o script antes
    # do teste de $LASTEXITCODE -- quem chamou receberia a mensagem crua da
    # libpq em vez da instrucao de qual e o modo certo.
    $env:PGPASSWORD = $senhaOwner
    $preferenciaAnterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $schema = psql -U $Owner -h $Host_ -p $Porta -d $Banco -w -t -A `
                       -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'gestao';" 2>&1
    } finally {
        $ErrorActionPreference = $preferenciaAnterior
    }

    if ($LASTEXITCODE -ne 0) {
        throw ("Nao foi possivel conectar em '$Banco' como '$Owner'. " +
               "Confira o nome do banco, o host e a senha.")
    }
    if ((($schema -join '').Trim()) -ne '1') {
        throw "O banco '$Banco' nao tem o schema 'gestao'. Use a instalacao (sem -Atualizar) para cria-lo."
    }
    Escreve "Banco '$Banco' encontrado, com o schema gestao. Nenhum dado sera apagado." Green

} else {
    Escreve '--- Preparando role e banco ---' Cyan

    # A role precisa de CREATEROLE: o script 03 executa CREATE ROLE app_gestao.
    # gestao_owner nao e recriada: pode ser dona de objetos em outros bancos do
    # cluster, e o DROP falharia. Reaplicar senha e atributos basta.
    if (Existe "SELECT 1 FROM pg_roles WHERE rolname = '$Owner';") {
        Psql-Super "ALTER ROLE $Owner WITH LOGIN CREATEROLE PASSWORD '$senhaOwner';" | Out-Null
        Escreve "Role '$Owner' ja existia -- senha e atributos atualizados." Green
    } else {
        Psql-Super "CREATE ROLE $Owner WITH LOGIN CREATEROLE PASSWORD '$senhaOwner';" | Out-Null
        Escreve "Role '$Owner' criada." Green
    }

    # Recriar e o padrao deste modo: 01 a 03 montam o schema do zero e nao se
    # aplicam sobre um banco existente -- o CREATE TABLE falharia logo no
    # primeiro. Para preservar os dados, use -Atualizar.
    $existeBanco = Existe "SELECT 1 FROM pg_database WHERE datname = '$Banco';"

    if ($existeBanco -and -not ($Forcar -or $Recriar)) {
        Escreve ''
        Escreve "ATENCAO: o banco '$Banco' ja existe e sera APAGADO com todos os seus dados." Yellow
        Escreve 'Para aplicar so os ajustes das sprints, preservando os dados, use -Atualizar.' Gray
        Escreve 'Use -Forcar para pular esta confirmacao.' Gray
        $conf = Read-Host "Digite o nome do banco para confirmar"
        if ($conf -ne $Banco) { throw 'Confirmacao nao confere. Nada foi alterado.' }
    }

    # Ordem: primeiro o banco, depois as roles -- enquanto o banco existir, elas
    # ainda detem privilegios la dentro e o DROP ROLE e recusado. As roles caem
    # mesmo sem o banco: sao do cluster, e 03 executa CREATE ROLE app_gestao sem
    # condicional -- uma sobra de instalacao anterior pararia o script justamente
    # na configuracao da RLS.
    Psql-Super "DROP DATABASE IF EXISTS $Banco WITH (FORCE);" | Out-Null
    Psql-Super "DROP ROLE IF EXISTS sge_api;"                 | Out-Null
    Psql-Super "DROP ROLE IF EXISTS app_gestao;"              | Out-Null

    if ($existeBanco) {
        Escreve "Banco '$Banco' e roles da aplicacao removidos." Green
    }

    Psql-Super "CREATE DATABASE $Banco OWNER $Owner;" | Out-Null
    Escreve "Banco '$Banco' criado com owner '$Owner'." Green
}

# -----------------------------------------------------------------------------
# 5. Rodar os scripts de schema (como owner, NAO como superusuario)
# -----------------------------------------------------------------------------
# Rodar como superusuario faria a RLS ser ignorada silenciosamente.
$env:PGPASSWORD = $senhaOwner

Escreve ''
if ($Atualizar) {
    Escreve '--- Aplicando os ajustes das sprints ---' Cyan
} else {
    Escreve '--- Instalando o schema ---' Cyan
}

foreach ($s in $aRodar) {
    Escreve "  $s ..." Gray
    psql -U $Owner -h $Host_ -p $Porta -d $Banco -w -v ON_ERROR_STOP=1 -q -f $s
    if ($LASTEXITCODE -ne 0) {
        throw "Erro em $s. A execucao foi interrompida."
    }
    Escreve "  $s OK" Green
}

# -----------------------------------------------------------------------------
# 6. Smoke test (opcional)
# -----------------------------------------------------------------------------
# O smoke test insere dados de teste: em -Atualizar isso sujaria um banco que
# tem dados reais, e e justamente o que esse modo existe para preservar.
if ($SmokeTest -and $Atualizar) {
    Escreve ''
    Escreve 'Smoke test ignorado: ele insere dados de teste, e -Atualizar preserva o banco.' Yellow
} elseif ($SmokeTest) {
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

if ($Atualizar) {
    Escreve ''
    Escreve 'Ajustes aplicados. No backend, rode em seguida:' Cyan
    Escreve '  npm run db:seed    # sincroniza as permissoes novas'
    Escreve '  npm run db:check   # confere se o banco esta pronto para a API'
}

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