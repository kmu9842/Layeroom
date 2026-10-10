using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

// A single portable EXE: embedded Chromium runtime + appended immutable artwork ZIP.
// No server, network, admin rights, Python or Node installation is used on launch.
internal static class Launcher {
    const string Magic = "LAYEROOMWIDGET1";
    static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LayeroomWidgets");
    [STAThread] static void Main() {
        Application.EnableVisualStyles();
        var splash = new Form { Text="Layeroom", Width=290, Height=95, FormBorderStyle=FormBorderStyle.FixedToolWindow, StartPosition=FormStartPosition.CenterScreen, ShowInTaskbar=false, TopMost=true };
        splash.Controls.Add(new Label { Text="위젯 준비 중…", Dock=DockStyle.Fill, TextAlign=ContentAlignment.MiddleCenter, Font=new Font("Malgun Gothic",11) });
        splash.Shown += async delegate {
            try { await Task.Run((Action)Launch); }
            catch (Exception error) { MessageBox.Show("위젯을 실행하지 못했습니다.\n"+error.Message,"Layeroom",MessageBoxButtons.OK,MessageBoxIcon.Error); }
            finally { splash.Close(); }
        };
        Application.Run(splash);
    }
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant(); }
    static void Extract(Stream stream,string destination) {
        Directory.CreateDirectory(destination);
        string root=Path.GetFullPath(destination)+Path.DirectorySeparatorChar;
        using(var zip=new ZipArchive(stream,ZipArchiveMode.Read,true)) {
            foreach(var entry in zip.Entries) {
                string target=Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                if(!target.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("잘못된 위젯 파일 경로입니다.");
                if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(target);continue;}
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using(var input=entry.Open())using(var output=File.Create(target))input.CopyTo(output);
            }
        }
        File.WriteAllText(Path.Combine(destination,".complete"),"1");
    }
    static void WithLock(string name,Action action) {
        using(var mutex=new Mutex(false,"Local\\LayeroomWidget-"+name)) {
            bool acquired=false;
            try { try { acquired=mutex.WaitOne(TimeSpan.FromMinutes(2)); } catch(AbandonedMutexException) { acquired=true; }
                if(!acquired)throw new IOException("다른 위젯이 준비 중입니다. 잠시 뒤 다시 실행해 주세요.");action();
            } finally { if(acquired)mutex.ReleaseMutex(); }
        }
    }
    static void Launch() {
        string executable=Assembly.GetExecutingAssembly().Location;
        byte[] payload; long payloadStart;
        using(var file=File.OpenRead(executable))using(var reader=new BinaryReader(file)) {
            if(file.Length<Magic.Length+8)throw new InvalidDataException("위젯 데이터가 없습니다.");
            file.Seek(-Magic.Length-8,SeekOrigin.End);long length=reader.ReadInt64();
            if(Encoding.ASCII.GetString(reader.ReadBytes(Magic.Length))!=Magic||length<=0||length>512L*1024*1024||length>file.Length-Magic.Length-8)throw new InvalidDataException("위젯 데이터가 손상되었습니다. 다시 내려받아 주세요.");
            payloadStart=file.Length-Magic.Length-8-length;
            file.Seek(payloadStart,SeekOrigin.Begin);payload=reader.ReadBytes((int)length);
        }
        string hash;using(var sha=SHA256.Create())hash=Hex(sha.ComputeHash(payload));
        string package=Path.Combine(Root,"packages",hash);
        WithLock(hash,delegate { if(!File.Exists(Path.Combine(package,".complete")))using(var stream=new MemoryStream(payload,false))Extract(stream,package); });
        string runtimeHash; long runtimeStart=0,runtimeLength=0;
        var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("runtime.sha256");
        if(resource!=null) { using(resource)using(var reader=new StreamReader(resource))runtimeHash=reader.ReadToEnd().Trim(); }
        else {
            const string runtimeMagic="LAYEROOMRUNTIME1";
            using(var file=File.OpenRead(executable))using(var reader=new BinaryReader(file)) {
                long footer=payloadStart-runtimeMagic.Length-8-32;
                if(footer<0)throw new InvalidDataException("위젯 실행 환경이 없습니다.");
                file.Position=footer;runtimeHash=Hex(reader.ReadBytes(32));runtimeLength=reader.ReadInt64();
                if(Encoding.ASCII.GetString(reader.ReadBytes(runtimeMagic.Length))!=runtimeMagic||runtimeLength<=0||runtimeLength>footer)
                    throw new InvalidDataException("위젯 실행 환경이 손상되었습니다.");
                runtimeStart=footer-runtimeLength;
            }
        }
        if(runtimeHash.Length!=64)throw new InvalidDataException("잘못된 런타임입니다.");
        string runtime=Path.Combine(Root,"runtime",runtimeHash);
        WithLock(runtimeHash,delegate {
            if(File.Exists(Path.Combine(runtime,".complete")))return;
            if(runtimeLength==0) { using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("runtime.zip"))Extract(stream,runtime); }
            else using(var file=File.OpenRead(executable))using(var stream=new SliceStream(file,runtimeStart,runtimeLength)) {
                using(var sha=SHA256.Create())if(Hex(sha.ComputeHash(stream))!=runtimeHash)throw new InvalidDataException("위젯 실행 환경의 검증에 실패했습니다.");
                stream.Position=0;Extract(stream,runtime);
            }
        });
        var start=new ProcessStartInfo(Path.Combine(runtime,"electron.exe"),"\""+package+"\"") { UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=package };
        start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        Process.Start(start);
    }
}

internal sealed class SliceStream : Stream {
    readonly Stream source; readonly long start,length; long position;
    public SliceStream(Stream input,long offset,long count) { source=input;start=offset;length=count; }
    public override bool CanRead {get{return true;}} public override bool CanSeek {get{return true;}} public override bool CanWrite {get{return false;}}
    public override long Length {get{return length;}} public override long Position {get{return position;}set{Seek(value,SeekOrigin.Begin);}}
    public override int Read(byte[] buffer,int offset,int count) {source.Position=start+position;int read=source.Read(buffer,offset,(int)Math.Min(count,length-position));position+=read;return read;}
    public override long Seek(long offset,SeekOrigin origin) {long next=(origin==SeekOrigin.Begin?0:origin==SeekOrigin.Current?position:length)+offset;if(next<0||next>length)throw new IOException("Invalid archive offset");position=next;return position;}
    public override void Flush() {} public override void SetLength(long value) {throw new NotSupportedException();} public override void Write(byte[] b,int o,int c) {throw new NotSupportedException();}
}
