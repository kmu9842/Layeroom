param([int]$AppPid, [string]$Screenshot, [switch]$Install)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class SetupCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int left,top,right,bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 delegate bool EnumProc(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int count);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
 public static IntPtr InstallButton(IntPtr parent) {
  IntPtr result=IntPtr.Zero;
  EnumChildWindows(parent,delegate(IntPtr hwnd,IntPtr data){var text=new StringBuilder(256);GetWindowText(hwnd,text,256);if(text.ToString()=="\uc124\uce58\ud558\uace0 \uc2e4\ud589")result=hwnd;return true;},IntPtr.Zero);
  return result;
 }
}
'@
$process = Get-Process -Id $AppPid
for ($attempt = 0; $attempt -lt 400; $attempt++) {
 $process.Refresh()
 if ($process.MainWindowHandle -ne 0) { break }
 Start-Sleep -Milliseconds 150
}
if ($process.MainWindowHandle -eq 0) { throw 'Setup window did not appear' }
$installButton=[IntPtr]::Zero
for ($attempt=0;$attempt -lt 200;$attempt++) {
 $installButton=[SetupCapture]::InstallButton($process.MainWindowHandle)
 if ($installButton -ne [IntPtr]::Zero) { break }
 Start-Sleep -Milliseconds 150
}
if ($installButton -eq [IntPtr]::Zero) { throw 'Install button not found' }
[SetupCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 250
$rectangle=[SetupCapture+Rect]::new()
[SetupCapture]::GetWindowRect($process.MainWindowHandle,[ref]$rectangle) | Out-Null
$bitmap=[System.Drawing.Bitmap]::new($rectangle.right-$rectangle.left,$rectangle.bottom-$rectangle.top)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$dc=$graphics.GetHdc()
try {
 if (-not [SetupCapture]::PrintWindow($process.MainWindowHandle,$dc,2)) { throw 'Setup capture failed' }
} finally { $graphics.ReleaseHdc($dc) }
$bitmap.Save($Screenshot,[System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose();$bitmap.Dispose()
if ($Install) {
 [SetupCapture]::SendMessage($installButton,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
}
Write-Output 'Captured actual setup window'
