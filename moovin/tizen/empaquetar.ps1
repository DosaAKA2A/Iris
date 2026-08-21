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
#
# Lo que entra es SOLO el arranque. La interfaz se la baja el propio arranque de
# iris.it.com cada vez que se abre la aplicacion, que es lo que permite que un
# push llegue a la tele sin reinstalar.
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Path $build | Out-Null

Copy-Item (Join-Path $aqui 'config.xml')     $build
Copy-Item (Join-Path $aqui 'index.html')     $build
Copy-Item (Join-Path $aqui 'arranque.js')    $build
Copy-Item (Join-Path $aqui 'icono\icon.png') $build

Write-Host "Arranque copiado a build\ (la interfaz se descarga sola en cada apertura)"

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
