Add-Type -AssemblyName System.Drawing
$taskRoot = Split-Path -Parent $PSScriptRoot
$resourceRoot = Join-Path $taskRoot 'apps\desktop\resources'
[System.IO.Directory]::CreateDirectory($resourceRoot) | Out-Null
$images = [System.Collections.Generic.List[byte[]]]::new()
$sizes = @(16,24,32,48,64,128,256)
foreach ($size in $sizes) {
 $bitmap = [System.Drawing.Bitmap]::new($size,$size)
 $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
 $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
 $graphics.Clear([System.Drawing.Color]::Transparent)
 $graphics.ScaleTransform($size/256.0,$size/256.0)
 $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
 $path.AddArc(8,8,104,104,180,90); $path.AddArc(144,8,104,104,270,90)
 $path.AddArc(144,144,104,104,0,90); $path.AddArc(8,144,104,104,90,90); $path.CloseFigure()
 $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#101218'))
 $graphics.FillPath($background,$path)
 $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#a68bfa'),22)
 $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
 $points = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(50,74),[System.Drawing.PointF]::new(84,184),[System.Drawing.PointF]::new(128,104),[System.Drawing.PointF]::new(172,184),[System.Drawing.PointF]::new(206,74))
 $graphics.DrawLines($pen,$points)
 $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#6ee7b7')); $graphics.FillEllipse($accent,196,64,20,20)
 $stream = [System.IO.MemoryStream]::new(); $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png); $images.Add($stream.ToArray())
 if ($size -eq 256) { $bitmap.Save((Join-Path $resourceRoot 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png) }
 $accent.Dispose(); $pen.Dispose(); $background.Dispose(); $path.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose()
}
$ico = [System.IO.File]::Create((Join-Path $resourceRoot 'icon.ico')); $writer = [System.IO.BinaryWriter]::new($ico)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i=0;$i -lt $sizes.Count;$i++) {
 $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
 $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset); $offset += $images[$i].Length
}
foreach ($data in $images) { $writer.Write([byte[]]$data) }; $writer.Dispose(); $ico.Dispose()
Write-Output 'Generated WeCode icon.png and multi-resolution icon.ico.'
