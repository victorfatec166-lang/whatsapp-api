# Gera o icone do Windows (cliente/deliveryadmin.ico) a partir da marca.
#
# POR QUE POWERSHELL E NAO NODE
#
# O `.ico` multi-resolucao e' formato do Windows e nao ha biblioteca de imagem no
# projeto -- GDI+ vem com o proprio sistema. O `favicon.ico` da marca tem 16, 32 e
# 48; para executavel e atalho do Windows falta a de 256, que e' a que o Explorer
# mostra na tela de altura e na Lista de programas.

param(
    [string]$Fonte = (Join-Path $PSScriptRoot '..\marca\tile-vermelho.png'),
    [string]$Destino = (Join-Path $PSScriptRoot '..\cliente\deliveryadmin.ico')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# 256 e' a maior que o Windows usa; 24 e' a da barra de tarefa pequena.
$tamanhos = @(16, 24, 32, 48, 64, 128, 256)

# O tile da marca ocupa a arte inteira. Sem folga ele encosta na borda da imagem e
# em 16px parece cortado, entao o desenho entra menor e centralizado.
$folga = 0.07

$origem = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Fonte))
$entradas = @()

foreach ($t in $tamanhos) {
    $bmp = New-Object System.Drawing.Bitmap($t, $t, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $m = [int][Math]::Round($t * $folga)
    $desenho = $t - 2 * $m
    $g.DrawImage($origem, [System.Drawing.Rectangle]::new($m, $m, $desenho, $desenho))
    $g.Dispose()

    <#
     * A entrada vai como PNG e nao como BMP 32bpp cru, que e' o formato antigo:
     * o Windows le PNG dentro de `.ico` desde o Vista, e o BMP de 256px sozinho
     * custaria 262 KB de arquivo -- o icone inteiro passaria de 360 KB.
     #>
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $dados = $ms.ToArray()
    $ms.Dispose()

    $entradas += @{ Dados = $dados; Largura = $t; Altura = $t }
    Write-Host ("  {0,3}x{0,-3} {1,7:N1} KB" -f $t, ($dados.Length / 1KB))
}

$origem.Dispose()
$saida = [System.IO.Path]::GetFullPath($Destino)

$escritor = New-Object System.IO.BinaryWriter([System.IO.File]::Create($saida))
$escritor.Write([uint16]0)
$escritor.Write([uint16]1)
$escritor.Write([uint16]$entradas.Count)

$deslocamento = 6 + 16 * $entradas.Count
foreach ($e in $entradas) {
    $escritor.Write([byte]$(if ($e.Largura -ge 256) { 0 } else { $e.Largura }))
    $escritor.Write([byte]$(if ($e.Altura -ge 256) { 0 } else { $e.Altura }))
    $escritor.Write([byte]0)
    $escritor.Write([byte]0)
    $escritor.Write([uint16]1)
    $escritor.Write([uint16]32)
    $escritor.Write([uint32]$e.Dados.Length)
    $escritor.Write([uint32]$deslocamento)
    $deslocamento += $e.Dados.Length
}

foreach ($e in $entradas) {
    $escritor.Write($e.Dados)
}

$escritor.Dispose()

Write-Host ''
Write-Host ("Icone gravado: {0} ({1:N1} KB, {2} resolucoes)" -f $saida, ((Get-Item -LiteralPath $saida).Length / 1KB), $entradas.Count)