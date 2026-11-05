# WRFFMB 死命令的机器化落地（2026-11-05 站长拍板）：
# 「每次提交线上之后，都要对 WRFFMB（站点一致性校验 workflow）进行一次检查」。
#
# 用法（PowerShell 工具里跑）：
#   .\scripts\check-ci.ps1            # 检查当前 HEAD
#   .\scripts\check-ci.ps1 <sha12>    # 检查指定 commit
#
# 行为：轮询 GitHub Actions API，直到该 commit 上「站点一致性校验」
# workflow 跑完（最长 12 分钟），全绿 exit 0，判红/超时 exit 1。
#
# 为什么是 PowerShell 而不是 node：本机 node(undici) 与 libcurl 均报
# UNABLE_TO_VERIFY_LEAF_SIGNATURE，只有 Windows 证书库通道（PowerShell
# Invoke-RestMethod）能通 api.github.com。语法按 5.1 兼容写，pwsh 7 同样可跑。
#
# 2026-11-05 自查修复：无参数调用曾报「不能对 Null 值表达式调用方法 .Trim()」。
# 根因是本机 PortableGit 的 cmd/git.exe 在 PowerShell 5.1 下
# `& $exe -C <repo> rev-parse HEAD` 静默返回空（实测 RAW=[]、LASTEXITCODE 空），
# 旧代码直接对空值 .Trim()。现改为**优先直读 .git/HEAD + ref 文件**（零依赖），
# git.exe 只作兜底且逐层判空；Script 不再需要 PATH 里有 git。

param(
    [string]$Sha
)
$ErrorActionPreference = 'Stop'
$Repo = 'dujeongil-galaxy/shuangxiugou'
$Workflow = '站点一致性校验'
$TimeoutMin = 12

# 直读 .git 取当前 HEAD，不依赖 git.exe（见文件头注释）。
function Resolve-HeadSha {
    param([string]$RepoRoot)
    $gitDir = Join-Path $RepoRoot '.git'
    $headFile = Join-Path $gitDir 'HEAD'
    if (Test-Path -LiteralPath $headFile) {
        $head = (Get-Content -LiteralPath $headFile -Raw).Trim()
        if ($head -match '^ref:\s*(.+)$') {
            $refName = $Matches[1].Trim()
            $refFile = Join-Path $gitDir $refName
            if (Test-Path -LiteralPath $refFile) {
                $v = (Get-Content -LiteralPath $refFile -Raw).Trim()
                if ($v -match '^[0-9a-fA-F]{40}$') { return $v }
            }
            # 分支 ref 被打包进 packed-refs 的情况
            $packed = Join-Path $gitDir 'packed-refs'
            if (Test-Path -LiteralPath $packed) {
                foreach ($line in (Get-Content -LiteralPath $packed)) {
                    if ($line -match ('^([0-9a-fA-F]{40})\s+' + [regex]::Escape($refName) + '$')) {
                        return $Matches[1]
                    }
                }
            }
        } elseif ($head -match '^[0-9a-fA-F]{40}$') {
            return $head
        }
    }
    # 兜底：PATH 里的 git / 常见安装路径；每一步都判空，绝不 blind .Trim()
    $candidates = @()
    $gcmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gcmd) { $candidates += $gcmd.Source }
    $candidates += @(
        'D:\Program Files\WorkBuddy\resources\vendor\PortableGit\cmd\git.exe',
        (Join-Path $env:USERPROFILE '.workbuddy\binaries\PortableGit\current\mingw64\bin\git.exe'),
        'C:\Program Files\Git\cmd\git.exe'
    )
    foreach ($g in $candidates) {
        if (-not $g -or -not (Test-Path -LiteralPath $g)) { continue }
        $o = & $g -C $RepoRoot rev-parse HEAD 2>$null
        if ($o) {
            $v = ([string]$o).Trim()
            if ($v -match '^[0-9a-fA-F]{40}$') { return $v }
        }
    }
    return $null
}

if (-not $Sha) {
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
    $Sha = Resolve-HeadSha -RepoRoot $repoRoot
    if (-not $Sha) {
        Write-Output 'ERR: 无法解析当前 HEAD（.git 与 git.exe 都没给出 40 位哈希）；请显式传 -Sha <hash>'
        exit 1
    }
}
if ($Sha -notmatch '^[0-9a-fA-F]{7,40}$') {
    Write-Output ("ERR: Sha 不是合法提交哈希：{0}" -f $Sha)
    exit 1
}
$Sha = $Sha.Substring(0, [Math]::Min(12, $Sha.Length))

# 无需 token：公开仓库的 Actions API 匿名可读（rate limit 60/h 足够轮询用）。
$h = @{ 'User-Agent' = 'sxg-check-ci' }
Write-Output ("WRFFMB 检查：{0} @ {1}" -f $Repo, $Sha)

$deadline = (Get-Date).AddMinutes($TimeoutMin)
$notFound = 0
while ((Get-Date) -lt $deadline) {
    try {
        $d = Invoke-RestMethod -Uri ("https://api.github.com/repos/{0}/actions/runs?branch=main&per_page=30" -f $Repo) -Headers $h -TimeoutSec 30
    } catch {
        Write-Output ('… API 瞬时失败（' + $_.Exception.Message + '），20s 后重试')
        Start-Sleep -Seconds 20
        continue
    }
    $run = $null
    foreach ($r in $d.workflow_runs) {
        if ($r.name -eq $Workflow -and $r.head_sha.StartsWith($Sha)) { $run = $r; break }
    }
    if ($run) {
        if ($run.status -eq 'completed') {
            if ($run.conclusion -eq 'success') {
                Write-Output ("全绿：站点一致性校验 run #{0}（{1}）通过" -f $run.run_number, $run.id)
                exit 0
            }
            $jobs = Invoke-RestMethod -Uri ("https://api.github.com/repos/{0}/actions/runs/{1}/jobs" -f $Repo, $run.id) -Headers $h -TimeoutSec 30
            $bad = @()
            foreach ($j in $jobs.jobs) { if ($j.conclusion -ne 'success') { $bad += $j.name } }
            Write-Output ("判红：站点一致性校验 run #{0} —— {1}" -f $run.run_number, ($bad -join '、'))
            exit 1
        }
        Write-Output ("… run #{0} 进行中（{1}），20s 后再查" -f $run.run_number, $run.status)
    } else {
        $notFound++
        if ($notFound -eq 3) {
            Write-Output '… 提示：HEAD 常是 CI 的 [skip ci] 版本号补提交，本身不触发 workflow；'
            Write-Output '        此时请显式传上一个提交哈希：-Sha <hash>（2026-11-05 自查踩到）。'
        }
        Write-Output '… 该 commit 的校验 run 尚未出现（等 push 触发）'
    }
    Start-Sleep -Seconds 20
}
Write-Output "超时：12 分钟未见站点一致性校验跑完 —— CI 可能排队或未触发，人工上 GitHub 看一眼"
exit 1
