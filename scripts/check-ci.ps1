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
# Invoke-RestMethod）能通 api.github.com。pwsh 7 未装，用内置 5.1
# ——仅当 HTTP 客户端用，语法全部按 5.1 兼容写。

param(
    [string]$Sha
)
$ErrorActionPreference = 'Stop'
$Repo = 'dujeongil-galaxy/shuangxiugou'
$Workflow = '站点一致性校验'
$TimeoutMin = 12

if (-not $Sha) {
    # 需要当前 HEAD 哈希：本机 PATH 不含 git，逐个探测 PortableGit
    $gitExe = $null
    foreach ($c in @(
        'D:\Program Files\WorkBuddy\resources\vendor\PortableGit\cmd\git.exe',
        (Join-Path $env:USERPROFILE '.workbuddy\binaries\PortableGit\current\mingw64\bin\git.exe'),
        'C:\Program Files\Git\cmd\git.exe'
    )) {
        if (Test-Path $c) { $gitExe = $c; break }
    }
    if (-not $gitExe) { Write-Output 'ERR: 未传 Sha 且找不到 git.exe'; exit 1 }
    $Sha = (& $gitExe -C (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) rev-parse HEAD).Trim()
}
$Sha = $Sha.Substring(0, [Math]::Min(12, $Sha.Length))

# 无需 token：公开仓库的 Actions API 匿名可读（rate limit 60/h 足够轮询用）。
$h = @{ 'User-Agent' = 'sxg-check-ci' }
Write-Output ("WRFFMB 检查：{0} @ {1}" -f $Repo, $Sha)

$deadline = (Get-Date).AddMinutes($TimeoutMin)
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
        Write-Output '… 该 commit 的校验 run 尚未出现（等 push 触发）'
    }
    Start-Sleep -Seconds 20
}
Write-Output "超时：12 分钟未见站点一致性校验跑完 —— CI 可能排队或未触发，人工上 GitHub 看一眼"
exit 1
