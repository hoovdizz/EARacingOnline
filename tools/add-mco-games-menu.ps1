$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$mcoRoot = Join-Path $repoRoot 'MCO'
$encoding = [System.Text.Encoding]::GetEncoding(1252)
$updated = 0

Get-ChildItem -LiteralPath $mcoRoot -Filter '*.html' -File -Recurse | ForEach-Object {
    $path = $_.FullName
    $html = [System.IO.File]::ReadAllText($path, $encoding)
    if ($html -notmatch 'left_nav_base\.gif' -or $html -match '>GAMES</span>') {
        return
    }

    $relativePath = $path.Substring($mcoRoot.Length + 1)
    $depth = ($relativePath -split '[\\/]').Count - 1
    $rootPrefix = '../' * ($depth + 1)

    $pattern = '(?m)^(?<indent>\s*)(?<base><td[^\r\n]*?<img\s+src="(?<imagePrefix>[^"]*)images/ui/left_nav_base\.gif"[^\r\n]*</td>)'
    $match = [regex]::Match($html, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        throw "Could not identify the left navigation base in $relativePath"
    }

    $indent = $match.Groups['indent'].Value
    $imagePrefix = $match.Groups['imagePrefix'].Value
    $base = $match.Groups['base'].Value
    $rows = @(
        "${indent}<td width=`"141`" background=`"${imagePrefix}images/ui/nav_button_tile.jpg`" valign=`"middle`" align=`"left`" nowrap height=`"16`"><span class=`"leftnavlg`"><img src=`"${imagePrefix}images/ui/tier1out.gif`" width=`"34`" height=`"16`" border=`"0`" vspace=`"0`" hspace=`"0`" align=`"texttop`">GAMES</span></td>"
        "${indent}</tr>"
        "${indent}<tr>"
        "${indent}  <td width=`"141`" background=`"${imagePrefix}images/ui/nav_button_tile.jpg`" valign=`"middle`" align=`"left`" nowrap height=`"16`"><a href=`"${rootPrefix}HS/HighStakes.html`" class=`"leftnavlg`"><img src=`"${imagePrefix}images/ui/tier2out.gif`" width=`"34`" height=`"16`" border=`"0`" vspace=`"0`" hspace=`"0`" align=`"texttop`">HIGH STAKES</a></td>"
        "${indent}</tr>"
        "${indent}<tr>"
        "${indent}  <td width=`"141`" background=`"${imagePrefix}images/ui/nav_button_tile.jpg`" valign=`"middle`" align=`"left`" nowrap height=`"16`"><a href=`"${rootPrefix}PU/PorscheUnleashed.html`" class=`"leftnavlg`"><img src=`"${imagePrefix}images/ui/tier2out.gif`" width=`"34`" height=`"16`" border=`"0`" vspace=`"0`" hspace=`"0`" align=`"texttop`">PORSCHE UNLEASHED</a></td>"
        "${indent}</tr>"
        "${indent}<tr>"
        "${indent}${base}"
    ) -join "`r`n"

    $updatedHtml = $html.Substring(0, $match.Index) + $rows + $html.Substring($match.Index + $match.Length)
    [System.IO.File]::WriteAllText($path, $updatedHtml, $encoding)
    $updated++
}

Write-Output "Updated $updated MCO pages."
