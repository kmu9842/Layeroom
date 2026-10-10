using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

// Application code is shipped inside the EXE; downloaded dependencies stay local.
internal static class Bundle {
    public static string Prepare(string packageRoot) {
        string root=Path.Combine(packageRoot,"_internal");
        Directory.CreateDirectory(root);
        string prefix=Path.GetFullPath(root)+Path.DirectorySeparatorChar;
        var files=new List<string>();
        using(var source=Assembly.GetExecutingAssembly().GetManifestResourceStream("Layeroom.Application")) {
            if(source==null)throw new IOException("앱 실행 파일이 손상되었습니다. ZIP을 다시 압축 해제해 주세요.");
            using(var archive=new ZipArchive(source,ZipArchiveMode.Read))foreach(var entry in archive.Entries) {
                string name=entry.FullName;
                if(name.Contains("\\")||name.Contains(":")||name.StartsWith("/")||Array.IndexOf(name.Split('/'),"..")>=0)
                    throw new IOException("앱 파일 경로가 올바르지 않습니다.");
                string target=Path.GetFullPath(Path.Combine(root,name.Replace('/',Path.DirectorySeparatorChar)));
                if(!target.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new IOException("앱 폴더를 벗어난 경로입니다.");
                files.Add(name);
                byte[] bytes;using(var input=entry.Open())using(var memory=new MemoryStream()){input.CopyTo(memory);bytes=memory.ToArray();}
                bool same=false;
                if(File.Exists(target)&&new FileInfo(target).Length==bytes.Length)using(var sha=SHA256.Create())using(var previous=File.OpenRead(target))
                    same=Convert.ToBase64String(sha.ComputeHash(previous))==Convert.ToBase64String(sha.ComputeHash(bytes));
                if(same)continue;
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                string temporary=target+".updating";File.WriteAllBytes(temporary,bytes);
                if(File.Exists(target))File.Delete(target);File.Move(temporary,target);
            }
        }
        string inventory=Path.Combine(root,".application-files.json");
        var json=new JavaScriptSerializer();
        if(File.Exists(inventory))foreach(string previous in json.Deserialize<string[]>(File.ReadAllText(inventory))) {
            string top=previous.Split('/')[0];
            if(Array.IndexOf(new[]{"backend","dist","portable","third_party","widget","licenses"},top)<0)continue;
            string target=Path.GetFullPath(Path.Combine(root,previous.Replace('/',Path.DirectorySeparatorChar)));
            if(!files.Contains(previous)&&target.StartsWith(prefix,StringComparison.OrdinalIgnoreCase)&&File.Exists(target))File.Delete(target);
        }
        File.WriteAllText(inventory,json.Serialize(files),new UTF8Encoding(false));
        return root;
    }
}
