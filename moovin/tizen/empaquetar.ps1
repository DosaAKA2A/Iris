<#
    MOOVIN para televisores Samsung — empaquetado e instalacion
    ---------------------------------------------------------------------------
    Arma el .wgt con la interfaz dentro y, si se le da la IP del televisor, lo
    instala. Todo lo que hace falta preparar UNA sola vez (modo desarrollador en
    la tele, certificado) esta en LEEME.md, aqui al lado.

    Uso:
        .\empaquetar.ps1                      solo arma el paquete
        .\empaquetar.ps1 -Ip 192.168.1.40     lo arma y lo instala en la tele
        .\empaquetar.ps1 -Ip 192.168.1.40 -Perfil miperfil

    El paquete NO se guarda en el repositorio: sale en build\ y en el .wgt, que
    van ignorados. Lo que se versiona es de donde salen.
#>
param(
    [string]$Ip = '',
    [string]$Perfil = '',
    [string]$TizenStudio = ''
)

$ErrorActionPreference = 'Stop'
$aqui   = Split-Path -Parent $MyInvocation.MyCommand.Path
$moovin = Split-Path -Parent $aqui
$build  = Join-Path $aqui 'build'

# ---------------------------------------------------------------- herramientas
# El CLI de Tizen no se pone en el PATH al instalar Tizen Studio, asi que se
# busca donde suele caer. -TizenStudio manda si esta en otro sitio.
$candidatos = @()
if ($TizenStudio) { $candidatos += $TizenStudio }
$candidatos += @(
    'C:\tizen-studio',
    "$env:USERPROFILE\tizen-studio",
    'C:\Program Files\tizen-studio',
    "$env:LOCALAPPDATA\tizen-studio"
)
$raiz = $candidatos | Where-Object { Test-Path (Join-Path $_ 'tools\ide\bin\tizen.bat') } | Select-Object -First 1
if (-not $raiz) {
    throw "No encuentro Tizen Studio. Instalalo (ver LEEME.md) o pasa la ruta con -TizenStudio."
}
$tizen = Join-Path $raiz 'tools\ide\bin\tizen.bat'
$sdb   = Join-Path $raiz 'tools\sdb.exe'
Write-Host "Tizen Studio: $raiz"

# ------------------------------------------------------------------ el paquete
# Se arma de cero en cada pasada: un archivo que se quedo de una version
# anterior es la clase de fallo que solo se ve en la tele y cuesta media hora.
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Path $build | Out-Null
New-Item -ItemType Directory -Path (Join-Path $build 'assets') | Out-Null

Copy-Item (Join-Path $aqui 'config.xml')          $build
Copy-Item (Join-Path $aqui 'icono\icon.png')      $build
Copy-Item (Join-Path $moovin 'adaptable.css')     $build
Copy-Item (Join-Path $moovin 'adaptable.js')      $build
Copy-Item (Join-Path (Split-Path -Parent $moovin) 'assets\moovin-favicon.svg') (Join-Path $build 'assets')

# El HTML trae dos rutas que arrancan en la raiz del sitio y dentro del paquete
# no llevan a ningun sitio: el favicon y el enlace a la portada del estudio. La
# primera se reapunta a la copia local; la segunda, a la web, que es a donde
# quiere ir de verdad.
#
# Se escribe con .NET y UTF-8 SIN BOM a proposito: Out-File mete la marca de
# orden de bytes al principio del archivo y el motor de Tizen se encuentra tres
# bytes raros antes del <!DOCTYPE>.
$html = [System.IO.File]::ReadAllText((Join-Path $moovin 'index.html'), [System.Text.Encoding]::UTF8)
$html = $html.Replace('href="/assets/moovin-favicon.svg"', 'href="assets/moovin-favicon.svg"')
$html = $html.Replace('href="/"', 'href="https://iris.it.com/"')
$sinBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $build 'index.html'), $html, $sinBom)

Write-Host "Interfaz copiada a build\"

# ------------------------------------------------------------ firmar y empacar
$argsPack = @('package', '-t', 'wgt', '--', $build)
if ($Perfil) { $argsPack = @('package', '-t', 'wgt', '-s', $Perfil, '--', $build) }
& $tizen @argsPack
if ($LASTEXITCODE -ne 0) { throw "El empaquetado fallo. Si se queja del certificado, revisa el perfil activo (LEEME.md)." }

$wgt = Get-ChildItem -Path $build -Filter '*.wgt' | Select-Object -First 1
if (-not $wgt) { throw "No se genero ningun .wgt." }
$destino = Join-Path $aqui $wgt.Name
Move-Item $wgt.FullName $destino -Force
Write-Host "Paquete listo: $destino"

# ---------------------------------------------------------------- instalacion
if (-not $Ip) {
    Write-Host ""
    Write-Host "Para instalarlo: .\empaquetar.ps1 -Ip <la IP de la tele>"
    return
}

# El puerto 26101 es el que abre el modo desarrollador de la tele. Si la
# conexion falla casi siempre es que el modo esta apagado o que la tele se
# reinicio y lo perdio.
& $sdb connect "${Ip}:26101"
if ($LASTEXITCODE -ne 0) { throw "No conecto con $Ip. Comprueba el modo desarrollador en la tele (LEEME.md)." }

$dispositivo = (& $sdb devices | Select-String $Ip | Select-Object -First 1)
if (-not $dispositivo) { throw "La tele conecto pero no aparece en la lista de dispositivos." }
$nombre = ($dispositivo -split '\s+')[-1]

& $tizen install -n $destino -t $nombre
if ($LASTEXITCODE -ne 0) { throw "La instalacion fallo. El mensaje de arriba dice por que." }

Write-Host ""
Write-Host "MOOVIN instalado. Esta en la fila de aplicaciones de la tele, al final."
