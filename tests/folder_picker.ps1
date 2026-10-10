param([int]$AppPid, [string]$Destination, [string]$Screenshot)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class NativeFolderTest {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int left,top,right,bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr w,string text);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr w,StringBuilder text);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
 delegate bool EnumProc(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int count);
 public static IntPtr Child(IntPtr parent,string caption) {
  IntPtr result=IntPtr.Zero;
  EnumChildWindows(parent,delegate(IntPtr hwnd,IntPtr data){var text=new StringBuilder(2048);SendMessage(hwnd,0x000D,new IntPtr(2048),text);if(text.ToString().Replace("&","").StartsWith(caption))result=hwnd;return true;},IntPtr.Zero);
  return result;
 }
 public static IntPtr Browse(IntPtr parent){return Child(parent,"\ucc3e\uc544\ubcf4\uae30\u2026");}
 public static IntPtr Picker(){return FindWindow("#32770","Layeroom \uc124\uce58 \ud3f4\ub354 \uc120\ud0dd");}
 public static IntPtr Choose(IntPtr picker){return Child(picker,"\uc774 \ud3f4\ub354 \uc120\ud0dd");}
 public static IntPtr FolderField(IntPtr parent){IntPtr result=IntPtr.Zero;EnumChildWindows(parent,delegate(IntPtr hwnd,IntPtr data){if(GetDlgCtrlID(hwnd)==1152)result=hwnd;return true;},IntPtr.Zero);return result;}
}
'@
$process=Get-Process -Id $AppPid
$setup=$process.MainWindowHandle
$browse=[NativeFolderTest]::Browse($setup)
if ($browse -eq [IntPtr]::Zero) {throw 'Browse button missing'}
[NativeFolderTest]::PostMessage($browse,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
$picker=[IntPtr]::Zero
for($i=0;$i -lt 120;$i++) {$picker=[NativeFolderTest]::Picker();if($picker -ne [IntPtr]::Zero){break};Start-Sleep -Milliseconds 100}
if($picker -eq [IntPtr]::Zero){throw 'Native Windows Explorer folder picker did not open'}
[NativeFolderTest]::SetForegroundWindow($picker) | Out-Null
Start-Sleep -Milliseconds 300
$field=[NativeFolderTest]::FolderField($picker)
if($field -eq [IntPtr]::Zero){throw 'Native folder entry field missing'}
[NativeFolderTest]::SendMessage($field,0x000C,[IntPtr]::Zero,$Destination) | Out-Null
Start-Sleep -Milliseconds 500
$rect=[NativeFolderTest+Rect]::new()
[NativeFolderTest]::GetWindowRect($picker,[ref]$rect) | Out-Null
$bitmap=[System.Drawing.Bitmap]::new($rect.right-$rect.left,$rect.bottom-$rect.top)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap);$dc=$graphics.GetHdc()
try{if(-not [NativeFolderTest]::PrintWindow($picker,$dc,2)){throw 'Folder picker capture failed'}}finally{$graphics.ReleaseHdc($dc)}
$bitmap.Save($Screenshot,[System.Drawing.Imaging.ImageFormat]::Png);$graphics.Dispose();$bitmap.Dispose()
$choose=[NativeFolderTest]::Choose($picker)
if($choose -eq [IntPtr]::Zero){throw 'Choose folder button missing'}
[NativeFolderTest]::PostMessage($choose,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 600
if([NativeFolderTest]::IsWindow($picker)){
 $choose=[NativeFolderTest]::Choose($picker)
 [NativeFolderTest]::PostMessage($choose,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
}
for($i=0;$i -lt 120 -and [NativeFolderTest]::IsWindow($picker);$i++){Start-Sleep -Milliseconds 100}
for($i=0;$i -lt 30 -and [NativeFolderTest]::Child($setup,$Destination) -eq [IntPtr]::Zero;$i++){Start-Sleep -Milliseconds 100}
if([NativeFolderTest]::Child($setup,$Destination) -eq [IntPtr]::Zero){throw 'Selected installation path was not applied'}
Write-Output 'PASS: native Explorer folder selection updates the installation path'
