<#
    check-site.ps1  -  Post-deploy verification for the vopth.xyz blog

    WHAT IT DOES
      1. Requests every key page / asset and reports the HTTP status
      2. Verifies the third-party JS is actually self-hosted (not from a CDN)
      3. Verifies unknown paths return the custom 404 page
      4. Verifies the homepage contains the expected markup
      5. Scans the delivered HTML for third-party CDN references
         (the site is built to be fully self-hosted, so any hit is a regression)

    USAGE
      # check the live custom domain
      powershell -ExecutionPolicy Bypass -File tools\check-site.ps1

      # check a workers.dev / pages.dev preview URL instead
      powershell -ExecutionPolicy Bypass -File tools\check-site.ps1 -BaseUrl https://vopth-blog.example.workers.dev

    EXIT CODE
      0 = all required checks passed
      1 = at least one required check failed

    NOTE
      Output is intentionally ASCII-only. Windows PowerShell 5.1 mis-decodes
      BOM-less UTF-8 script files, so non-ASCII text here would print as garbage.
#>

param(
    [string]$BaseUrl = 'https://vopth.xyz'
)

$ErrorActionPreference = 'Continue'
$BaseUrl = $BaseUrl.TrimEnd('/')

$script:Pass = 0
$script:Fail = 0
$script:Warn = 0

function Write-Result {
    param([string]$Label, [string]$State, [string]$Detail = '')
    $mark = switch ($State) {
        'PASS'  { '[ OK ]' }
        'FAIL'  { '[FAIL]' }
        'WARN'  { '[WARN]' }
        default { '[    ]' }
    }
    if ($Detail) {
        Write-Host ('{0} {1,-56} {2}' -f $mark, $Label, $Detail)
    } else {
        Write-Host ('{0} {1}' -f $mark, $Label)
    }
}

# Decode a response body to a UTF-8 string.
# PowerShell 5.1 hands back byte[]; PowerShell 7 hands back string.
function Get-BodyText {
    param($Response)
    if ($null -eq $Response) { return '' }
    if ($Response.Content -is [byte[]]) {
        return [System.Text.Encoding]::UTF8.GetString($Response.Content)
    }
    return [string]$Response.Content
}

# Fetch a URL and ALWAYS return a hashtable - never throw.
# On non-2xx we still try hard to capture the response body.
function Invoke-Page {
    param([string]$Url)

    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 6
        return @{ Ok = $true; Status = [int]$r.StatusCode; Body = (Get-BodyText $r) }
    }
    catch {
        $status = 0
        $body = ''

        # PowerShell 7 exposes the error body here
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $body = [string]$_.ErrorDetails.Message
        }

        if ($_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch { }

            # Windows PowerShell 5.1: read the (synchronous) response stream
            if (-not $body) {
                try {
                    $stream = $_.Exception.Response.GetResponseStream()
                    if ($stream) {
                        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
                        $body = $reader.ReadToEnd()
                        $reader.Close()
                    }
                } catch { }
            }
        }

        return @{ Ok = $false; Status = $status; Body = $body; Error = $_.Exception.Message }
    }
}

Write-Host ''
Write-Host '=============================================================='
Write-Host ' vopth.xyz  post-deploy check'
Write-Host " Target: $BaseUrl"
Write-Host '=============================================================='
Write-Host ''

# ---------------------------------------------------------------- 1. endpoints
Write-Host '--- 1. Pages and assets ---'

$endpoints = @(
    @{ Path = '/';                                 Name = 'home page' },
    @{ Path = '/about/';                           Name = 'about / profile page' },
    @{ Path = '/archives/';                        Name = 'archives' },
    @{ Path = '/categories/';                      Name = 'categories' },
    @{ Path = '/tags/';                            Name = 'tags' },
    @{ Path = '/link/';                            Name = 'friend links' },
    @{ Path = '/2026/10/03/hello-vopth/';          Name = 'post: hello-vopth' },
    @{ Path = '/2026/10/03/hexo-writing-guide/';   Name = 'post: writing guide' },
    @{ Path = '/atom.xml';                         Name = 'RSS feed' },
    @{ Path = '/search.xml';                       Name = 'search index' },
    @{ Path = '/feed';                             Name = 'feed alias -> atom.xml' },
    @{ Path = '/css/custom.css';                   Name = 'custom.css' },
    @{ Path = '/js/profile-hero.js';               Name = 'profile-hero.js' },
    @{ Path = '/img/avatar.svg';                   Name = 'avatar' },
    @{ Path = '/img/banner-home.svg';              Name = 'home banner' },
    @{ Path = '/img/favicon.svg';                  Name = 'favicon' },
    @{ Path = '/sitemap.xml';                      Name = 'sitemap (SEO)' },
    @{ Path = '/robots.txt';                       Name = 'robots.txt (SEO)' }
)

$homeBody = $null

foreach ($e in $endpoints) {
    $res = Invoke-Page ($BaseUrl + $e.Path)
    if ($res.Status -eq 200) {
        Write-Result $e.Name 'PASS' '200'
        $script:Pass++
        if ($e.Path -eq '/') { $homeBody = $res.Body }
    } else {
        Write-Result $e.Name 'FAIL' "HTTP $($res.Status)"
        $script:Fail++
    }
}

Write-Host ''

# ------------------------------------------------------- 2. self-hosted assets
Write-Host '--- 2. Self-hosted third-party JS (must be 200) ---'

$selfHosted = @(
    '/pluginsSrc/@fortawesome/fontawesome-free/css/all.min.css',
    '/pluginsSrc/typed.js/dist/typed.umd.js',
    '/pluginsSrc/medium-zoom/dist/medium-zoom.min.js',
    '/pluginsSrc/instant.page/instantpage.js'
)

foreach ($p in $selfHosted) {
    $res = Invoke-Page ($BaseUrl + $p)
    if ($res.Status -eq 200) {
        Write-Result $p 'PASS' '200'
        $script:Pass++
    } else {
        Write-Result $p 'FAIL' "HTTP $($res.Status)"
        $script:Fail++
    }
}

Write-Host ''

# ------------------------------------------------------------ 3. 404 handling
Write-Host '--- 3. Custom 404 page ---'

$res404 = Invoke-Page ($BaseUrl + '/this-page-does-not-exist-12345/')

if ($res404.Status -eq 404) {
    if ($res404.Body -match 'error-num|error-wrap|404') {
        Write-Result 'unknown path -> custom 404' 'PASS' 'HTTP 404 with custom body'
        $script:Pass++
    } else {
        Write-Result 'unknown path -> custom 404' 'WARN' 'HTTP 404 but body is generic'
        $script:Warn++
    }
} else {
    Write-Result 'unknown path -> custom 404' 'FAIL' "HTTP $($res404.Status) (expected 404)"
    $script:Fail++
}

Write-Host ''

# -------------------------------------------------------- 4. homepage content
Write-Host '--- 4. Homepage content ---'

if ($homeBody) {
    $contentChecks = @(
        @{ Name = 'site title "Vopth"';      Test = ($homeBody -match 'Vopth') },
        @{ Name = 'profile card script';      Test = ($homeBody -match 'profile-hero\.js') },
        @{ Name = 'custom stylesheet';        Test = ($homeBody -match 'css/custom\.css') },
        @{ Name = 'home banner image';        Test = ($homeBody -match 'banner-home\.svg') },
        @{ Name = 'local fontawesome';        Test = ($homeBody -match 'pluginsSrc/@fortawesome') },
        @{ Name = 'local typed.js';           Test = ($homeBody -match 'pluginsSrc/typed\.js') },
        @{ Name = 'nav menu link /about/';    Test = ($homeBody -match 'href="/about/"') },
        @{ Name = 'post cards rendered';      Test = ($homeBody -match 'recent-post-item') },
        @{ Name = 'RSS autodiscovery';        Test = ($homeBody -match 'atom\.xml') },
        @{ Name = 'Open Graph meta';          Test = ($homeBody -match 'og:title') },
        @{ Name = 'canonical link';           Test = ($homeBody -match 'rel="canonical"') },
        @{ Name = 'link rel=sitemap';         Test = ($homeBody -match 'rel="sitemap"') },
        @{ Name = 'charset utf-8';            Test = ($homeBody -match 'charset="utf-8"') },
        @{ Name = 'html lang zh-CN';          Test = ($homeBody -match 'lang="zh-CN"') }
    )

    foreach ($c in $contentChecks) {
        if ($c.Test) {
            Write-Result $c.Name 'PASS'
            $script:Pass++
        } else {
            Write-Result $c.Name 'FAIL' 'not found in HTML'
            $script:Fail++
        }
    }
} else {
    Write-Result 'homepage content' 'FAIL' 'could not fetch homepage'
    $script:Fail++
}

Write-Host ''

# --------------------------------------------------------- 5. no external CDN
Write-Host '--- 5. Third-party CDN independence ---'

if ($homeBody) {
    $banned = 'jsdelivr|unpkg\.com|googleapis|gstatic\.com|cdnjs\.cloudflare|fonts\.google|gravatar'
    $hits = [regex]::Matches($homeBody, $banned)
    if ($hits.Count -eq 0) {
        Write-Result 'no external CDN references' 'PASS' 'fully self-hosted'
        $script:Pass++
    } else {
        $found = ($hits | ForEach-Object { $_.Value } | Sort-Object -Unique) -join ', '
        Write-Result 'no external CDN references' 'FAIL' "found: $found"
        $script:Fail++
    }
} else {
    Write-Result 'no external CDN references' 'FAIL' 'no homepage body'
    $script:Fail++
}

Write-Host ''

# ------------------------------------------------------------- 6. transport
Write-Host '--- 6. Transport ---'

if ($BaseUrl -like 'https://*') {
    Write-Result 'served over HTTPS' 'PASS' $BaseUrl
    $script:Pass++
} else {
    Write-Result 'served over HTTPS' 'WARN' 'target is HTTP, TLS not verified'
    $script:Warn++
}

Write-Host ''
Write-Host '=============================================================='
Write-Host (' RESULT:  {0} passed, {1} failed, {2} warnings' -f $script:Pass, $script:Fail, $script:Warn)
Write-Host '=============================================================='
Write-Host ''

if ($script:Fail -gt 0) { exit 1 }
exit 0
