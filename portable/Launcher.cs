using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Layeroom")]
[assembly: System.Reflection.AssemblyProduct("Layeroom")]
[assembly: System.Reflection.AssemblyVersion("1.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.1.0.0")]

internal static class Launcher {
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string packageRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string root = packageRoot;
        string key;
        using (var sha = SHA256.Create()) key = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", "").Substring(0, 24);
        bool fresh;
        using (var mutex = new Mutex(true, "Local\\Layeroom-" + key, out fresh))
        using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Layeroom-Open-" + key))
        using (var setup = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Layeroom-Setup-" + key))
        using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Layeroom-Stop-" + key)) {
            if (Array.IndexOf(args, "--stop") >= 0) { if (!fresh) stop.Set(); return; }
            if (!fresh) { if(Array.IndexOf(args,"--setup")>=0)setup.Set();else if (Array.IndexOf(args, "--no-browser") < 0) show.Set(); return; }
            try {root=Bundle.Prepare(InstallLocation.Read(packageRoot));}
            catch(Exception error){MessageBox.Show("이 폴더에 앱 파일을 준비할 수 없습니다. 쓰기 가능한 위치로 폴더 전체를 옮긴 뒤 실행하세요.\n\n"+packageRoot+"\n\n"+error.Message,"Layeroom",MessageBoxButtons.OK,MessageBoxIcon.Error);Environment.ExitCode=1;return;}
            int headless=Array.IndexOf(args,"--install");
            if(headless>=0) {
                Console.OutputEncoding=new UTF8Encoding(false);Console.InputEncoding=new UTF8Encoding(false);
                try {
                    string choice=headless+1<args.Length?args[headless+1]:"core";
                    if(choice!="core"&&choice!="cpu"&&choice!="cuda")throw new ArgumentException("Choose core, cpu or cuda");
                    Components.Install(root,choice=="core"?"none":choice,Array.IndexOf(args,"--widget")>=0,Array.IndexOf(args,"--repair")>=0,
                        delegate(string message,int progress){Console.WriteLine(progress+"% "+message);},CancellationToken.None);
                }catch(Exception error){Console.Error.WriteLine(error.Message);Environment.ExitCode=1;}
                return;
            }
            try {
                bool configure=Array.IndexOf(args,"--setup")>=0;
                do {
                    if(File.Exists(Components.Manifest(root))&&(configure||!Components.CoreReady(root)))
                        using(var wizard=new SetupForm(root,stop)) {
                            if(wizard.ShowDialog()!=DialogResult.OK)return;
                            root=wizard.InstallRoot;
                        }
                    var studio=new Studio(root,show,stop,setup,Array.IndexOf(args,"--no-browser")<0);
                    Application.Run(studio);configure=studio.NeedsSetup;
                }while(configure);
            }
            catch (Exception e) { MessageBox.Show(e.Message, "Layeroom 실행 오류", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
    }
}

internal sealed class Studio : ApplicationContext {
    readonly string root, url, instance = Guid.NewGuid().ToString("N");
    readonly EventWaitHandle show, stop, setup;
    public bool NeedsSetup {get;private set;}
    readonly NotifyIcon tray;
    readonly System.Windows.Forms.Timer timer;
    readonly Process server;
    readonly StreamWriter log;
    readonly object logLock = new object();
    readonly Job job;
    Form splash;
    bool ready, closing, openWhenReady;
    DateTime started = DateTime.UtcNow;
    public Studio(string folder, EventWaitHandle openEvent, EventWaitHandle stopEvent, EventWaitHandle setupEvent, bool openBrowser) {
        root = folder; show = openEvent; stop = stopEvent; setup=setupEvent; openWhenReady = openBrowser;
        string python = Path.Combine(root, "runtime\\python\\python.exe");
        if (!File.Exists(python) || !File.Exists(Path.Combine(root, "dist\\index.html")))
            throw new Exception("ZIP 파일 전체를 한 폴더에 압축 해제한 뒤 Layeroom.exe를 실행해 주세요.");
        string data = Path.Combine(root, "data");
        Directory.CreateDirectory(data);
        Directory.CreateDirectory(Path.Combine(data, "logs"));
        string logFile = Path.Combine(data, "logs\\server.log");
        if (File.Exists(logFile) && new FileInfo(logFile).Length > 10485760) File.Move(logFile, logFile + "." + DateTime.Now.ToString("yyyyMMddHHmmss"));
        log = new StreamWriter(logFile, true, new UTF8Encoding(false)); log.AutoFlush = true;
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        url = "http://127.0.0.1:" + port;
        var info = new ProcessStartInfo(python, "-X utf8 -B \"" + Path.Combine(root, "portable\\server.py") + "\" --port " + port) {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        info.EnvironmentVariables.Remove("PYTHONHOME"); info.EnvironmentVariables.Remove("PYTHONPATH");
        info.EnvironmentVariables["PYTHONNOUSERSITE"] = "1";
        info.EnvironmentVariables["LAYEROOM_INSTANCE"] = instance;
        info.EnvironmentVariables["LAYEROOM_LAUNCHER"] = Application.ExecutablePath;
        server = new Process { StartInfo = info };
        server.OutputDataReceived += WriteLog; server.ErrorDataReceived += WriteLog;
        job = new Job();
        try { server.Start(); job.Assign(server); server.BeginOutputReadLine(); server.BeginErrorReadLine(); }
        catch { try { if (!server.HasExited) server.Kill(); } catch { } job.Dispose(); log.Dispose(); throw; }
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Layeroom", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("프로그램 열기", null, delegate { Open(); });
        menu.Items.Add("사용 가이드", null, delegate { Process.Start(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "guide")); });
        menu.Items.Add("라이선스", null, delegate { Process.Start(Path.Combine(root, "licenses\\THIRD-PARTY.txt")); });
        if(File.Exists(Components.Manifest(root)))menu.Items.Add("구성요소 설치",null,delegate {Configure();});
        menu.Items.Add("설치 폴더 열기", null, delegate { Process.Start(Directory.GetParent(root).FullName); });
        menu.Items.Add("작품 폴더 열기", null, delegate { Process.Start(Path.Combine(root,"data\\cards")); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("종료", null, delegate { ExitThread(); });
        tray.ContextMenuStrip = menu; tray.DoubleClick += delegate { Open(); };
        if (openBrowser) {
            splash = new Form { Text = "Layeroom", Size = new Size(370, 130), FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterScreen };
            splash.Controls.Add(new Label { Text = "프로그램을 준비하고 있습니다…", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("맑은 고딕", 12) });
            splash.FormClosed += delegate { if (!ready) ExitThread(); }; splash.Show();
        }
        timer = new System.Windows.Forms.Timer { Interval = 300 };
        timer.Tick += Tick; timer.Start();
    }
    void WriteLog(object sender, DataReceivedEventArgs e) { if (e.Data != null) lock (logLock) { if (!closing) log.WriteLine(e.Data); } }
    void Open() { if (ready) Process.Start(url); else openWhenReady = true; }
    void Configure() {
        if(!ready)return;
        try {
            var request=(HttpWebRequest)WebRequest.Create(url+"/api/health");request.Proxy=null;request.Timeout=1000;
            using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())) {
                var health=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(reader.ReadToEnd());
                if(health.ContainsKey("busy")&&(bool)health["busy"]){MessageBox.Show("이미지 처리가 끝난 뒤 구성요소를 설치해 주세요.","Layeroom");return;}
            }
        }catch(WebException){return;}
        NeedsSetup=true;ExitThread();
    }
    void Tick(object sender, EventArgs args) {
        if (stop.WaitOne(0)) { ExitThread(); return; }
        if (show.WaitOne(0)) Open();
        if (setup.WaitOne(0)) {Configure();if(closing)return;}
        if (server.HasExited) { Fail("프로그램이 종료되었습니다. _internal\\data\\logs\\server.log에서 원인을 확인할 수 있습니다."); return; }
        if (ready) return;
        try {
            var request = (HttpWebRequest)WebRequest.Create(url + "/api/health"); request.Timeout = 200; request.Proxy = null;
            using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream())) {
                var health = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(reader.ReadToEnd());
                if (!health.ContainsKey("instance") || (string)health["instance"] != instance) return;
            }
            ready = true;
            File.WriteAllText(Path.Combine(root, "data\\runtime.json"), new JavaScriptSerializer().Serialize(new { url = url, pid = server.Id, launcher = Process.GetCurrentProcess().Id, instance = instance }), Encoding.UTF8);
            if (splash != null) { splash.Close(); splash.Dispose(); splash = null; }
            if (openWhenReady) Open();
        } catch (WebException) { }
        if (!ready && (DateTime.UtcNow - started).TotalSeconds > 120) Fail("시작 시간이 초과되었습니다. _internal\\data\\logs\\server.log를 확인해 주세요.");
    }
    void Fail(string message) { MessageBox.Show(message, "Layeroom", MessageBoxButtons.OK, MessageBoxIcon.Error); ExitThread(); }
    protected override void ExitThreadCore() {
        if (closing) return;
        closing = true;
        if (timer != null) { timer.Stop(); timer.Dispose(); }
        if (tray != null) { tray.Visible = false; tray.Dispose(); }
        if (splash != null) splash.Dispose();
        job.Dispose();
        try { server.WaitForExit(3000); } catch { }
        server.Dispose();
        lock (logLock) log.Dispose();
        try { File.Delete(Path.Combine(root, "data\\runtime.json")); } catch { }
        base.ExitThreadCore();
    }
}

// The owned server is also terminated if Windows closes or kills the launcher.
internal sealed class Job : IDisposable {
    IntPtr handle;
    [StructLayout(LayoutKind.Sequential)] struct Basic { public long time1, time2; public uint flags; public UIntPtr min, max; public uint count; public UIntPtr affinity; public uint priority, scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct Counters { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic; public Counters io; public UIntPtr a,b,c,d; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref Limits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public Job() { handle = CreateJobObject(IntPtr.Zero, null); var limits = new Limits(); limits.basic.flags = 0x2000; if (handle == IntPtr.Zero || !SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits))) { Dispose(); throw new Exception("실행 프로세스를 초기화하지 못했습니다."); } }
    public void Assign(Process process) { if (!AssignProcessToJobObject(handle, process.Handle)) throw new Exception("서버 프로세스를 관리할 수 없습니다."); }
    public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
}
