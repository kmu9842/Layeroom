using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Components {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    public static Dictionary<string,object> Read(string file) { return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8)); }
    public static Dictionary<string,object> Child(Dictionary<string,object> data,string key) {return (Dictionary<string,object>)data[key];}
    public static string Manifest(string root) {return Path.Combine(root,"portable\\components.json");}
    public static bool CoreReady(string root) {
        if(!File.Exists(Path.Combine(root,"runtime\\python\\python.exe")))return false;
        if(!File.Exists(Manifest(root)))return true; // Existing complete/offline distributions.
        if(File.Exists(Path.Combine(root,"runtime-manifest.json")))return true;
        try {var core=Child(Child(Read(Manifest(root)),"components"),"core");return (string)Read(Path.Combine(root,"data\\components\\core.json"))["fingerprint"]==(string)core["fingerprint"];}
        catch {return false;}
    }
    public static string Size(long bytes) {return bytes>=1000000000?(bytes/1000000000.0).ToString("0.00")+" GB":(bytes/1000000.0).ToString("0.0")+" MB";}
    static string Hash(string file) {using(var stream=File.OpenRead(file))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    static string Download(string root,Dictionary<string,object> item,Action<string,int> progress,CancellationToken token) {
        string cache=Path.Combine(root,"data\\downloads");Directory.CreateDirectory(cache);
        string expected=(string)item["sha256"],file=Path.Combine(cache,expected+".download"),part=Path.Combine(cache,expected+".part");
        long total=Convert.ToInt64(item["bytes"]);
        if(File.Exists(file)&&new FileInfo(file).Length==total&&Hash(file)==expected)return file;
        if(File.Exists(file))File.Delete(file);
        long offset=File.Exists(part)?new FileInfo(part).Length:0;
        if(offset>total){File.Delete(part);offset=0;}
        if(offset<total) {
            var request=(HttpWebRequest)WebRequest.Create((string)item["url"]);request.UserAgent="Layeroom/1";request.Timeout=45000;request.ReadWriteTimeout=45000;request.AddRange(offset);
            using(token.Register(delegate {request.Abort();}))using(var response=(HttpWebResponse)request.GetResponse()) {
                if(response.StatusCode==HttpStatusCode.PartialContent) {
                    string range=response.Headers["Content-Range"]??"";
                    if(!range.StartsWith("bytes "+offset+"-")||!range.EndsWith("/"+total))throw new IOException("이어받기 응답이 올바르지 않습니다.");
                }else offset=0;
                using(var input=response.GetResponseStream())using(var output=new FileStream(part,offset>0?FileMode.Append:FileMode.Create,FileAccess.Write)) {
                    var buffer=new byte[1024*1024];int read;DateTime report=DateTime.MinValue;
                    while((read=input.Read(buffer,0,buffer.Length))>0) {
                        token.ThrowIfCancellationRequested();output.Write(buffer,0,read);offset+=read;
                        if(offset>total)throw new IOException("파일 크기가 예상과 다릅니다.");
                        if((DateTime.UtcNow-report).TotalMilliseconds>150){progress("기본 실행 환경 다운로드 · "+Size(offset)+" / "+Size(total),(int)(offset*100/total));report=DateTime.UtcNow;}
                    }
                }
            }
        }
        token.ThrowIfCancellationRequested();progress("다운로드 파일 검증 중",100);
        if(new FileInfo(part).Length!=total)throw new IOException("다운로드가 중단되었습니다. 다시 설치하면 이어받습니다.");
        if(Hash(part)!=expected){File.Delete(part);throw new IOException("파일 검증에 실패했습니다. 다시 시도해 주세요.");}
        File.Move(part,file);return file;
    }
    static void Extract(string file,string folder,bool crt,CancellationToken token) {
        string root=Path.GetFullPath(folder)+Path.DirectorySeparatorChar;Directory.CreateDirectory(root);
        using(var input=File.OpenRead(file))using(var zip=new ZipArchive(input,ZipArchiveMode.Read))foreach(var entry in zip.Entries) {
            token.ThrowIfCancellationRequested();
            if(crt&&!entry.FullName.EndsWith(".dll",StringComparison.OrdinalIgnoreCase))continue;
            if(crt&&entry.FullName.IndexOf('/')>=0)continue;
            string target=Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
            if(!target.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new IOException("잘못된 설치 경로입니다.");
            if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(target);continue;}
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using(var source=entry.Open())using(var output=File.Create(target))source.CopyTo(output);
        }
    }
    public static void Install(string root,string ai,bool widget,bool repair,Action<string,int> progress,CancellationToken token) {
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
        var manifest=Read(Manifest(root));var python=Child(manifest,"python");
        string runtime=Path.Combine(root,"runtime\\python"),stamp=Path.Combine(runtime,".python-ready");
        if(!File.Exists(stamp)||File.ReadAllText(stamp)!=(string)python["sha256"]) {
            string archive=Download(root,python,progress,token);progress("기본 실행 환경 준비 중",100);Extract(archive,runtime,false,token);
            string crt=Download(root,Child(manifest,"crt"),progress,token);Extract(crt,runtime,true,token);
            File.WriteAllText(Path.Combine(runtime,"python313._pth"),"python313.zip\n.\nLib/site-packages\n",new UTF8Encoding(false));
            File.WriteAllText(stamp,(string)python["sha256"]);File.Delete(archive);File.Delete(crt);
        }
        token.ThrowIfCancellationRequested();
        string arguments="-X utf8 -B -u \""+Path.Combine(root,"portable\\install.py")+"\" --ai "+ai+(widget?" --widget":"")+(repair?" --repair":"");
        var info=new ProcessStartInfo(Path.Combine(runtime,"python.exe"),arguments) {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
        info.EnvironmentVariables.Remove("PYTHONHOME");info.EnvironmentVariables.Remove("PYTHONPATH");
        string failure="구성요소 설치에 실패했습니다.";
        using(var process=new Process {StartInfo=info})using(var job=new Job()) {
            process.Start();job.Assign(process);
            process.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(!String.IsNullOrWhiteSpace(e.Data))failure=e.Data;};process.BeginErrorReadLine();
            using(token.Register(delegate {try {if(!process.HasExited)process.Kill();}catch{}})) {
                string line;
                while((line=process.StandardOutput.ReadLine())!=null)if(line.StartsWith("LAYEROOM_INSTALL:")) {
                    var data=Json.Deserialize<Dictionary<string,object>>(line.Substring("LAYEROOM_INSTALL:".Length));
                    string message=(string)data["message"];
                    if(data.ContainsKey("received"))message+=" · "+Size(Convert.ToInt64(data["received"]))+" / "+Size(Convert.ToInt64(data["total"]));
                    if(data.ContainsKey("error"))failure=message;
                    progress(message,Convert.ToInt32(data["percent"]));
                }
                process.WaitForExit();token.ThrowIfCancellationRequested();if(process.ExitCode!=0)throw new IOException(failure);
            }
        }
    }
}

internal sealed class SetupForm : Form {
    string root;readonly Dictionary<string,object> manifest;
    public string InstallRoot {get{return root;}}
    readonly TextBox location=new TextBox();readonly Button browse=new Button();
    readonly CheckBox ai=new CheckBox(),widget=new CheckBox(),repair=new CheckBox();
    readonly ComboBox device=new ComboBox();readonly Label summary=new Label(),status=new Label();
    readonly ProgressBar bar=new ProgressBar();readonly Button install=new Button(),cancel=new Button();
    CancellationTokenSource cancellation;bool busy;
    readonly System.Windows.Forms.Timer stopTimer=new System.Windows.Forms.Timer {Interval=300};bool stopRequested;
    public SetupForm(string folder,EventWaitHandle stopEvent) {
        root=folder;manifest=Components.Read(Components.Manifest(root));
        Text="Layeroom · 구성요소 설치";Font=new Font("맑은 고딕",10);ClientSize=new Size(660,650);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;StartPosition=FormStartPosition.CenterScreen;
        BackColor=Color.FromArgb(246,247,242);ForeColor=Color.FromArgb(42,57,48);
        Add(new Label {Text="Layeroom",Font=new Font("Segoe UI",22,FontStyle.Bold)},28,22,560,48);
        Add(new Label {Text="필요한 기능을 선택하세요. 공개 배포처에서 내려받습니다."},30,82,600,32);
        Add(new Label {Text="설치 위치",Font=new Font(Font,FontStyle.Bold)},32,120,595,24);
        location.Name="installation-path";location.Text=Directory.GetParent(root).FullName;location.ReadOnly=true;location.TabStop=false;location.Multiline=true;location.BackColor=Color.White;location.Font=new Font("Segoe UI",10);Add(location,32,148,490,48);
        browse.Name="browse-folder-button";browse.Text="찾아보기…";Add(browse,532,151,95,40);
        browse.Click+=delegate {try {string selected=FolderPicker.Choose(Handle,Directory.GetParent(root).FullName);if(selected!=null){root=Path.Combine(selected,"_internal");location.Text=selected;RefreshSize();}}catch(Exception error){MessageBox.Show(error.Message,"Layeroom",MessageBoxButtons.OK,MessageBoxIcon.Error);}};
        Add(new Label {Text="선택한 폴더의 _internal 안에 실행 환경·모델·작품을 저장합니다.\n찾아보기에서 위치를 고르면 다음 실행에도 같은 폴더를 사용합니다."},32,203,595,47);
        Add(new Label {Text="기본 실행 환경 · 필수\n액자 보기 · PSD 가져오기 · 레이어 편집"},32,264,595,50);
        ai.Text="자동 분절";ai.AutoSize=false;Add(ai,32,324,180,28);
        device.DropDownStyle=ComboBoxStyle.DropDownList;device.Items.AddRange(new object[]{"CPU · 그래픽카드 관계없이 사용","NVIDIA GPU · 빠른 분절"});device.SelectedIndex=0;device.Enabled=false;Add(device,215,322,412,32);
        widget.Text="위젯으로 받기 · 바탕화면 EXE 출력";Add(widget,32,367,595,30);
        repair.Text="선택한 구성요소 다시 설치";Add(repair,32,409,595,28);
        summary.Font=new Font(Font.FontFamily,11,FontStyle.Bold);Add(summary,32,451,595,32);
        status.Text="설치한 기능은 이후 인터넷 연결 없이 사용할 수 있습니다.\n선택 기능은 나중에 트레이 메뉴에서 추가할 수 있습니다.";Add(status,32,492,595,47);
        Add(bar,32,550,595,12);bar.Maximum=100;
        install.Name="install-button";install.Text="설치하고 실행";install.FlatStyle=FlatStyle.Flat;install.BackColor=Color.FromArgb(57,79,65);install.ForeColor=Color.White;Add(install,410,590,135,37);
        cancel.Text="닫기";Add(cancel,553,590,74,37);
        ai.CheckedChanged+=delegate {device.Enabled=ai.Checked;RefreshSize();};widget.CheckedChanged+=delegate{RefreshSize();};device.SelectedIndexChanged+=delegate{RefreshSize();};repair.CheckedChanged+=delegate{RefreshSize();};
        if(File.Exists(Path.Combine(root,"data\\components\\ai_cpu.json")))ai.Checked=true;
        if(File.Exists(Path.Combine(root,"data\\components\\ai_cuda.json"))){ai.Checked=true;device.SelectedIndex=1;}
        if(File.Exists(Path.Combine(root,"data\\components\\widget.json")))widget.Checked=true;
        install.Click+=async delegate {await StartInstall();};cancel.Click+=delegate {if(busy)cancellation.Cancel();else Close();};
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(busy){e.Cancel=true;cancellation.Cancel();}};
        stopTimer.Tick+=delegate {if(stopEvent.WaitOne(0)){stopRequested=true;if(busy)cancellation.Cancel();else Close();}};stopTimer.Start();
        FormClosed+=delegate {stopTimer.Stop();stopTimer.Dispose();};
        RefreshSize();AcceptButton=install;CancelButton=cancel;
    }
    void Add(Control control,int x,int y,int width,int height) {control.SetBounds(x,y,width,height);Controls.Add(control);}
    void RefreshSize() {
        var components=Components.Child(manifest,"components");long bytes=0;
        var keys=new List<string>{"core"};if(ai.Checked)keys.Add(device.SelectedIndex==0?"ai_cpu":"ai_cuda");if(widget.Checked)keys.Add("widget");
        foreach(string key in keys){bool installed=false;try{installed=(string)Components.Read(Path.Combine(root,"data\\components\\"+key+".json"))["fingerprint"]==(string)Components.Child(components,key)["fingerprint"];}catch{}
            if(repair.Checked||!installed)bytes+=Convert.ToInt64(Components.Child(components,key)["bytes"]);}
        summary.Text="다운로드 약 "+Components.Size(bytes);
    }
    void Report(string message,int percent) {if(IsDisposed||!IsHandleCreated)return;BeginInvoke((Action)delegate {if(IsDisposed)return;status.Text=message;bar.Value=Math.Max(0,Math.Min(100,percent));});}
    async Task StartInstall() {
        string selection=ai.Checked?(device.SelectedIndex==0?"cpu":"cuda"):"none";bool useWidget=widget.Checked,reinstall=repair.Checked;
        busy=true;cancellation=new CancellationTokenSource();install.Enabled=ai.Enabled=widget.Enabled=device.Enabled=repair.Enabled=browse.Enabled=false;cancel.Text="취소";
        try {
            root=Bundle.Prepare(Directory.GetParent(root).FullName);
            InstallLocation.Save(AppDomain.CurrentDomain.BaseDirectory,Directory.GetParent(root).FullName);
            await Task.Run(()=>Components.Install(root,selection,useWidget,reinstall,Report,cancellation.Token));busy=false;DialogResult=DialogResult.OK;Close();
        }
        catch(Exception error) {status.Text=cancellation.IsCancellationRequested?"설치를 취소했습니다. 다음 설치 때 이어받습니다.":error.Message;}
        finally {busy=false;cancellation.Dispose();if(!IsDisposed){if(stopRequested)Close();else{install.Enabled=ai.Enabled=widget.Enabled=repair.Enabled=browse.Enabled=true;device.Enabled=ai.Checked;cancel.Text="닫기";install.Text="다시 시도";RefreshSize();}}}
    }
}
