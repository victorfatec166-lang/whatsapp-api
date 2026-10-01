# Gera o icone do instalador. Sem isto o programa instalado aparece com o icone padrao do
# Windows em qualquer lista. Comentario aqui e' so com `#`: o bloco `/* */` do C# quebra o
# arquivo inteiro no primeiro `/`.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$saida = Join-Path $PSScriptRoot 'DeliveryAdmin.ico'

# As mesmas constantes de src/styles/app.css.
$acento = [System.Drawing.Color]::FromArgb(0xB4, 0x53, 0x09)
$superficie = [System.Drawing.Color]::FromArgb(0xFF, 0xFF, 0xFF)

# Windows usa icones de 16, 24, 32, 48, 64 e 256. Os pequenos sao redesenhados, e nao
# reduzidos: reduzir um desenho de 256 deixa a borda arredondada serrilhada, que e' o que
# faz icone parecer icone de 1998.
$tamanhos = @(16, 24, 32, 48, 64, 256)

function Desenha($tam) {
    $bmp = New-Object System.Drawing.Bitmap($tam, $tam)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    # O fundo e' um quadrado cheio de superficie, e o acento entra por cima como
    # um retangulo arredondado. Invertido (acento cheio) o "D" perderia
    # contraste em 16 px.
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($superficie)), 0, 0, $tam, $tam)

    $raio = [int]($tam * 0.2)
    $caminho = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $raio * 2
    $caminho.AddArc(0, 0, $d, $d, 180, 90)
    $caminho.AddArc($tam - $d, 0, $d, $d, 270, 90)
    $caminho.AddArc($tam - $d, $tam - $d, $d, $d, 0, 90)
    $caminho.AddArc(0, $tam - $d, $d, $d, 90, 90)
    $caminho.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush($acento)), $caminho)

    # O "D". Medido no Graphics para caber sempre, e com fonte escolhida pelo
    # tamanho: a 16 px uma fonte de 9 px vira um borrão de 3 pixels de altura.
    $tamanhoFonte = if ($tam -le 16) { 10 } elseif ($tam -le 24) { 15 } elseif ($tam -le 32) { 20 } elseif ($tam -le 48) { 30 } elseif ($tam -le 64) { 40 } else { 150 }
    $fonte = New-Object System.Drawing.Font('Segoe UI', [float]$tamanhoFonte, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush($superficie)
    $formato = New-Object System.Drawing.StringFormat
    $formato.Alignment = [System.Drawing.StringAlignment]::Center
    $formato.LineAlignment = [System.Drawing.StringAlignment]::Center
    $limites = New-Object System.Drawing.RectangleF(0, 0, $tam, $tam)
    $g.DrawString('D', $fonte, $brush, $limites, $formato)

    $fonte.Dispose()
    $brush.Dispose()
    $caminho.Dispose()
    $g.Dispose()
    return $bmp
}

$imagens = @()
foreach ($t in $tamanhos) { $imagens += , (Desenha $t) }

$ms = New-Object System.IO.MemoryStream
$escritor = New-Object System.IO.BinaryWriter($ms)
$escritor.Write([UInt16]0)                 # reservado
$escritor.Write([UInt16]1)                 # tipo 1 = icone
$escritor.Write([UInt16]$imagens.Count)

$offset = 6 + (16 * $imagens.Count)
$dados = @()

foreach ($bmp in $imagens) {
    $tam = $bmp.Width

    # O bitmap de cada tamanho, guardado como PNG dentro do .ico.
    $tmp = New-Object System.IO.MemoryStream
    $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $tmp.ToArray()
    $dados += , $bytes

    $escritor.Write([Byte]($tam -band 0xFF))     # largura  (0 = 256)
    $escritor.Write([Byte]($tam -band 0xFF))     # altura
    $escritor.Write([Byte]0)                     # cores
    $escritor.Write([Byte]0)                     # reservado
    $escritor.Write([UInt16]1)                   # planos
    $escritor.Write([UInt16]32)                  # bits por pixel
    $escritor.Write([UInt32]$bytes.Length)
    $escritor.Write([UInt32]$offset)
    $offset += $bytes.Length

    $tmp.Dispose()
    $bmp.Dispose()
}

foreach ($bloco in $dados) { $escritor.Write($bloco) }
$escritor.Flush()
$escritor.Close()

[System.IO.File]::WriteAllBytes($saida, $ms.ToArray())
$ms.Dispose()

Write-Host ''
Write-Host ('  Icone gerado: ' + $saida)
Write-Host ('  Tamanhos: ' + ($tamanhos -join ', '))
Write-Host ''
